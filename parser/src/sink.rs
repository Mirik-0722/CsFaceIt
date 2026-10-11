//! The database side of the worker: the status of a demo and the facts of its match. The tables belong to the backend
//! (its migrations `V1__init.sql`, `V2__demo_pipeline.sql` and `V3__analysis.sql`); the worker writes `rounds`,
//! `round_players`, `kills`, `damages` and `heat_bins`, creates the players it does not find, and moves a demo from
//! STORED to PARSED or FAILED.
//!
//! A demo can be stored again (a manual upload) while the worker is busy with its previous file, and the same message
//! can arrive twice. So the worker remembers the `updated_at` of the demo when it starts, as a version, and writes only
//! if the demo is still STORED with that version; otherwise its work is out of date and somebody else's to finish.

use std::collections::{BTreeSet, HashMap};
use std::str::FromStr;
use std::time::Duration;

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{PgConnection, PgPool, Row};

use crate::bins::HeatBin;
use crate::parse::{truncated, Facts};

pub const STORED: &str = "STORED";
pub const PARSED: &str = "PARSED";

/// The worker handles one demo at a time: one connection for the work, one to spare.
const MAX_CONNECTIONS: u32 = 2;
const ACQUIRE_TIMEOUT: Duration = Duration::from_secs(10);

/// How many rows one INSERT statement carries.
const BATCH_ROWS: usize = 5_000;

const MAX_NICKNAME_CHARS: usize = 64;

/// The prefix of the `faceit_id` of a player that is known by SteamID only.
const PLACEHOLDER_PREFIX: &str = "steam:";

pub struct DemoState {
    pub status: String,
    /// `updated_at` in microseconds: it changes whenever the backend touches the demo.
    pub version: i64,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct Counts {
    pub rounds: usize,
    pub round_players: usize,
    pub kills: usize,
    pub damages: usize,
    pub heat_bins: usize,
    pub players_created: u64,
}

pub enum Written {
    Done(Counts),
    /// The demo is no longer STORED, or was stored again: nothing was written.
    OutOfDate,
}

/// A pool that connects on first use, so the worker starts while the database is still coming up. The second value
/// describes the target for the log, without the credentials. Fails when `database_url` is not a PostgreSQL URL.
pub fn connect(database_url: &str) -> Result<(PgPool, String), sqlx::Error> {
    let options = PgConnectOptions::from_str(database_url)?;
    let target = format!(
        "{}:{}/{}",
        options.get_host(),
        options.get_port(),
        options.get_database().unwrap_or_default()
    );
    let pool = PgPoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .acquire_timeout(ACQUIRE_TIMEOUT)
        .connect_lazy_with(options);
    Ok((pool, target))
}

/// Whether an error is the database being away or busy rather than a statement being wrong: trying again may help.
pub fn is_transient(error: &sqlx::Error) -> bool {
    match error {
        sqlx::Error::Io(_)
        | sqlx::Error::Tls(_)
        | sqlx::Error::Protocol(_)
        | sqlx::Error::PoolTimedOut
        | sqlx::Error::PoolClosed
        | sqlx::Error::WorkerCrashed => true,
        // SQLSTATE classes: 08 connection, 40 rollback (serialization failure, deadlock), 53 out of resources,
        // 57 operator intervention (shutdown, cancelled query), 58 system error.
        sqlx::Error::Database(e) => e.code().is_some_and(|code| {
            ["08", "40", "53", "57", "58"]
                .iter()
                .any(|class| code.starts_with(class))
        }),
        _ => false,
    }
}

/// The status and version of a demo, or `None` when there is no such demo.
pub async fn state(pool: &PgPool, demo_id: i64) -> Result<Option<DemoState>, sqlx::Error> {
    let row = sqlx::query(
        "SELECT status, (extract(epoch FROM updated_at) * 1000000)::bigint AS version FROM demos WHERE id = $1",
    )
    .bind(demo_id)
    .fetch_optional(pool)
    .await?;
    match row {
        Some(row) => Ok(Some(DemoState {
            status: row.try_get("status")?,
            version: row.try_get("version")?,
        })),
        None => Ok(None),
    }
}

/// Replaces the facts of the demo's match with `facts` and `bins` and marks the demo PARSED, all in one transaction.
/// The demo row is locked first; unless it is STORED with the version `version`, nothing is written.
pub async fn write(
    pool: &PgPool,
    demo_id: i64,
    version: i64,
    facts: &Facts,
    bins: &[HeatBin],
) -> Result<Written, sqlx::Error> {
    let mut tx = pool.begin().await?;

    let demo = sqlx::query(
        "SELECT status, match_id, (extract(epoch FROM updated_at) * 1000000)::bigint AS version \
         FROM demos WHERE id = $1 FOR UPDATE",
    )
    .bind(demo_id)
    .fetch_optional(&mut *tx)
    .await?;
    // Returning early drops the transaction, which rolls it back.
    let Some(demo) = demo else {
        return Ok(Written::OutOfDate);
    };
    if demo.try_get::<String, _>("status")? != STORED
        || demo.try_get::<i64, _>("version")? != version
    {
        return Ok(Written::OutOfDate);
    }
    let match_id: i64 = demo.try_get("match_id")?;

    let (players, players_created) = resolve_players(&mut tx, facts, bins).await?;
    let player = |steam_id: u64| {
        players
            .get(&steam_id)
            .copied()
            .ok_or(sqlx::Error::RowNotFound)
    };
    let optional_player = |steam_id: Option<u64>| steam_id.map(player).transpose();

    sqlx::query("DELETE FROM heat_bins WHERE match_id = $1")
        .bind(match_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM damages WHERE match_id = $1")
        .bind(match_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM kills WHERE match_id = $1")
        .bind(match_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM round_players WHERE match_id = $1")
        .bind(match_id)
        .execute(&mut *tx)
        .await?;
    sqlx::query("DELETE FROM rounds WHERE match_id = $1")
        .bind(match_id)
        .execute(&mut *tx)
        .await?;

    for rounds in facts.rounds.chunks(BATCH_ROWS) {
        let defusers = rounds
            .iter()
            .map(|r| optional_player(r.defuser_steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        sqlx::query(
            "INSERT INTO rounds (match_id, round_number, winner_side, win_reason, start_tick, decided_tick, end_tick, \
             bomb_planted_tick, bomb_defused_tick, defuser_id) \
             SELECT $1::int8, * FROM UNNEST($2::int4[], $3::text[], $4::text[], $5::int4[], $6::int4[], $7::int4[], \
             $8::int4[], $9::int4[], $10::int8[])",
        )
        .bind(match_id)
        .bind(rounds.iter().map(|r| r.round_number).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.winner_side.map(|side| side.as_str())).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.win_reason.as_deref()).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.start_tick).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.decided_tick).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.end_tick).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.bomb_planted_tick).collect::<Vec<_>>())
        .bind(rounds.iter().map(|r| r.bomb_defused_tick).collect::<Vec<_>>())
        .bind(defusers)
        .execute(&mut *tx)
        .await?;
    }

    for round_players in facts.round_players.chunks(BATCH_ROWS) {
        let members = round_players
            .iter()
            .map(|p| player(p.steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        sqlx::query(
            "INSERT INTO round_players (match_id, round_number, player_id, side) \
             SELECT $1::int8, * FROM UNNEST($2::int4[], $3::int8[], $4::text[])",
        )
        .bind(match_id)
        .bind(
            round_players
                .iter()
                .map(|p| p.round_number)
                .collect::<Vec<_>>(),
        )
        .bind(members)
        .bind(
            round_players
                .iter()
                .map(|p| p.side.as_str())
                .collect::<Vec<_>>(),
        )
        .execute(&mut *tx)
        .await?;
    }

    for kills in facts.kills.chunks(BATCH_ROWS) {
        let killers = kills
            .iter()
            .map(|k| optional_player(k.killer_steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        let victims = kills
            .iter()
            .map(|k| player(k.victim_steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        let assisters = kills
            .iter()
            .map(|k| optional_player(k.assister_steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        sqlx::query(
            "INSERT INTO kills (match_id, round_number, tick, killer_id, victim_id, assister_id, weapon, headshot, \
             wallbang, noscope, thrusmoke, attacker_blind, killer_side, victim_side, killer_x, killer_y, victim_x, \
             victim_y) \
             SELECT $1::int8, * FROM UNNEST($2::int4[], $3::int4[], $4::int8[], $5::int8[], $6::int8[], $7::text[], \
             $8::bool[], $9::bool[], $10::bool[], $11::bool[], $12::bool[], $13::text[], $14::text[], $15::float4[], \
             $16::float4[], $17::float4[], $18::float4[])",
        )
        .bind(match_id)
        .bind(kills.iter().map(|k| k.round_number).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.tick).collect::<Vec<_>>())
        .bind(killers)
        .bind(victims)
        .bind(assisters)
        .bind(kills.iter().map(|k| k.weapon.as_str()).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.headshot).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.wallbang).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.noscope).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.thrusmoke).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.attacker_blind).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.killer_side.map(|side| side.as_str())).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.victim_side.map(|side| side.as_str())).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.killer_x).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.killer_y).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.victim_x).collect::<Vec<_>>())
        .bind(kills.iter().map(|k| k.victim_y).collect::<Vec<_>>())
        .execute(&mut *tx)
        .await?;
    }

    for damages in facts.damages.chunks(BATCH_ROWS) {
        let attackers = damages
            .iter()
            .map(|d| optional_player(d.attacker_steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        let victims = damages
            .iter()
            .map(|d| player(d.victim_steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        sqlx::query(
            "INSERT INTO damages (match_id, round_number, tick, attacker_id, victim_id, weapon, damage_health, \
             damage_armor) \
             SELECT $1::int8, * FROM UNNEST($2::int4[], $3::int4[], $4::int8[], $5::int8[], $6::text[], $7::int4[], \
             $8::int4[])",
        )
        .bind(match_id)
        .bind(damages.iter().map(|d| d.round_number).collect::<Vec<_>>())
        .bind(damages.iter().map(|d| d.tick).collect::<Vec<_>>())
        .bind(attackers)
        .bind(victims)
        .bind(damages.iter().map(|d| d.weapon.as_deref()).collect::<Vec<_>>())
        .bind(damages.iter().map(|d| d.damage_health).collect::<Vec<_>>())
        .bind(damages.iter().map(|d| d.damage_armor).collect::<Vec<_>>())
        .execute(&mut *tx)
        .await?;
    }

    for bins in bins.chunks(BATCH_ROWS) {
        let owners = bins
            .iter()
            .map(|b| player(b.steam_id))
            .collect::<Result<Vec<_>, _>>()?;
        sqlx::query(
            "INSERT INTO heat_bins (match_id, player_id, kind, side, bin_x, bin_y, count) \
             SELECT $1::int8, * FROM UNNEST($2::int8[], $3::text[], $4::text[], $5::int4[], $6::int4[], $7::int4[])",
        )
        .bind(match_id)
        .bind(owners)
        .bind(bins.iter().map(|b| b.kind.as_str()).collect::<Vec<_>>())
        .bind(bins.iter().map(|b| b.side.as_str()).collect::<Vec<_>>())
        .bind(bins.iter().map(|b| b.bin_x).collect::<Vec<_>>())
        .bind(bins.iter().map(|b| b.bin_y).collect::<Vec<_>>())
        .bind(bins.iter().map(|b| b.count).collect::<Vec<_>>())
        .execute(&mut *tx)
        .await?;
    }

    if let Some(map_name) = &facts.map_name {
        sqlx::query("UPDATE matches SET map_name = $2 WHERE id = $1 AND map_name IS NULL")
            .bind(match_id)
            .bind(map_name)
            .execute(&mut *tx)
            .await?;
    }
    sqlx::query("UPDATE demos SET status = $2, tick_rate = $3, error = NULL, updated_at = now() WHERE id = $1")
        .bind(demo_id)
        .bind(PARSED)
        .bind(facts.tick_rate)
        .execute(&mut *tx)
        .await?;
    tx.commit().await?;

    Ok(Written::Done(Counts {
        rounds: facts.rounds.len(),
        round_players: facts.round_players.len(),
        kills: facts.kills.len(),
        damages: facts.damages.len(),
        heat_bins: bins.len(),
        players_created,
    }))
}

/// Marks the demo FAILED with `error`, which users get to read, unless it is no longer STORED with the version
/// `version`. Returns whether the demo was marked.
pub async fn mark_failed(
    pool: &PgPool,
    demo_id: i64,
    version: i64,
    error: &str,
) -> Result<bool, sqlx::Error> {
    let marked = sqlx::query(
        "UPDATE demos SET status = 'FAILED', error = $2, updated_at = now() \
         WHERE id = $1 AND status = 'STORED' AND (extract(epoch FROM updated_at) * 1000000)::bigint = $3",
    )
    .bind(demo_id)
    .bind(error)
    .bind(version)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(marked == 1)
}

/// The `players.id` of every SteamID the facts mention, and how many players had to be created for it.
///
/// A player is found by `players.steam_id`. For a SteamID nobody has, a row `steam:<SteamID>` is inserted with the
/// name the player has in the demo; the backend gives the SteamID to the real player once it learns who that is. An
/// insert that meets a row somebody else is inserting waits for it and does nothing, and the row is read afterwards.
async fn resolve_players(
    tx: &mut PgConnection,
    facts: &Facts,
    bins: &[HeatBin],
) -> Result<(HashMap<u64, i64>, u64), sqlx::Error> {
    // Sorted, so that two workers creating the same players do it in the same order and cannot deadlock.
    let mut steam_ids: BTreeSet<u64> = BTreeSet::new();
    for kill in &facts.kills {
        steam_ids.insert(kill.victim_steam_id);
        steam_ids.extend(kill.killer_steam_id);
        steam_ids.extend(kill.assister_steam_id);
    }
    for damage in &facts.damages {
        steam_ids.insert(damage.victim_steam_id);
        steam_ids.extend(damage.attacker_steam_id);
    }
    steam_ids.extend(
        facts
            .rounds
            .iter()
            .filter_map(|round| round.defuser_steam_id),
    );
    steam_ids.extend(facts.round_players.iter().map(|player| player.steam_id));
    steam_ids.extend(bins.iter().map(|bin| bin.steam_id));

    let mut players: HashMap<u64, i64> = HashMap::new();
    if steam_ids.is_empty() {
        return Ok((players, 0));
    }

    let wanted: Vec<String> = steam_ids.iter().map(u64::to_string).collect();
    let found = sqlx::query("SELECT id, steam_id FROM players WHERE steam_id = ANY($1)")
        .bind(&wanted)
        .fetch_all(&mut *tx)
        .await?;
    for row in found {
        if let Ok(steam_id) = row.try_get::<String, _>("steam_id")?.parse::<u64>() {
            players.insert(steam_id, row.try_get("id")?);
        }
    }

    let missing: Vec<u64> = steam_ids
        .iter()
        .copied()
        .filter(|steam_id| !players.contains_key(steam_id))
        .collect();
    if missing.is_empty() {
        return Ok((players, 0));
    }
    let missing_ids: Vec<String> = missing.iter().map(u64::to_string).collect();
    let nicknames: Vec<String> = missing
        .iter()
        .map(|steam_id| {
            let name = facts
                .player_names
                .get(steam_id)
                .map(|name| truncated(name.trim(), MAX_NICKNAME_CHARS));
            name.filter(|name| !name.is_empty())
                .unwrap_or_else(|| steam_id.to_string())
        })
        .collect();
    let created = sqlx::query(
        "INSERT INTO players (faceit_id, nickname, steam_id) \
         SELECT $3 || p.steam_id, p.nickname, p.steam_id \
         FROM UNNEST($1::text[], $2::text[]) AS p(steam_id, nickname) ORDER BY p.steam_id \
         ON CONFLICT DO NOTHING",
    )
    .bind(&missing_ids)
    .bind(&nicknames)
    .bind(PLACEHOLDER_PREFIX)
    .execute(&mut *tx)
    .await?
    .rows_affected();

    // By SteamID again, and by placeholder id: a placeholder whose SteamID the backend has since given to a real
    // player still stands for that SteamID when nobody holds it any more.
    let placeholders: Vec<String> = missing
        .iter()
        .map(|steam_id| format!("{PLACEHOLDER_PREFIX}{steam_id}"))
        .collect();
    let rows = sqlx::query("SELECT id, steam_id, faceit_id FROM players WHERE steam_id = ANY($1) OR faceit_id = ANY($2)")
    .bind(&missing_ids)
    .bind(&placeholders)
    .fetch_all(&mut *tx)
    .await?;
    for row in rows {
        let id: i64 = row.try_get("id")?;
        let by_steam_id = row
            .try_get::<Option<String>, _>("steam_id")?
            .and_then(|steam_id| steam_id.parse::<u64>().ok());
        let by_placeholder = row
            .try_get::<String, _>("faceit_id")?
            .strip_prefix(PLACEHOLDER_PREFIX)
            .and_then(|steam_id| steam_id.parse::<u64>().ok());
        if let Some(steam_id) = by_steam_id.filter(|steam_id| missing.contains(steam_id)) {
            // The holder of a SteamID wins over its placeholder, in whatever order the two rows arrive.
            players.insert(steam_id, id);
        }
        if let Some(steam_id) = by_placeholder.filter(|steam_id| missing.contains(steam_id)) {
            players.entry(steam_id).or_insert(id);
        }
    }
    if missing
        .iter()
        .any(|steam_id| !players.contains_key(steam_id))
    {
        return Err(sqlx::Error::RowNotFound);
    }
    Ok((players, created))
}
