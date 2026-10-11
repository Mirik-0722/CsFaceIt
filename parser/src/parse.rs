//! Turns a CS2 demo file into facts: rounds, the players of every round, kills, damages and sampled positions. Nothing
//! is interpreted here; what a kill or a round means for a player's statistics is the backend's business.
//!
//! The reading is done by the `parser` crate of <https://github.com/LaihoE/demoparser> (the core of demoparser2). It
//! is asked twice. The first pass collects game events; every event carries the tick, the SteamID, name, team and
//! position of the players it names, and the state of the game rules. The second pass collects the position of every
//! player at the sampled ticks, because the crate gathers either events or per-tick values in one pass.

use std::collections::btree_map::Entry;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fmt;
use std::fs::File;
use std::io;
use std::path::Path;

use ahash::AHashMap;
use demoparser::first_pass::parser_settings::{rm_user_friendly_names, ParserInputs};
use demoparser::maps::ROUND_WIN_REASON;
use demoparser::parse_demo::{DemoOutput, Parser, ParsingMode};
use demoparser::second_pass::game_events::GameEvent;
use demoparser::second_pass::parser_settings::create_huffman_lookup_table;
use demoparser::second_pass::variants::{VarVec, Variant};
use memmap2::Mmap;
use prost::Message;
use tracing::{debug, warn};

/// What a demo says when it carries no playback information to derive the tick rate from. CS2 servers run at 64.
pub const DEFAULT_TICK_RATE: i32 = 64;

/// A position is taken every this many ticks.
pub const POSITION_SAMPLE_TICKS: i32 = 32;

/// The first bytes of a Source 2 demo.
const DEMO_MAGIC: &[u8; 8] = b"PBDEMS2\0";
/// The magic, then the offsets of the file information and of the spawn groups.
const DEMO_HEADER_LEN: usize = 16;
/// The demo command that carries the playback time and tick count.
const DEM_FILE_INFO: u32 = 2;

/// The column sizes of the database, in characters.
const MAX_WEAPON_CHARS: usize = 64;
const MAX_WIN_REASON_CHARS: usize = 32;
const MAX_MAP_NAME_CHARS: usize = 64;

const ROUND_START: &str = "round_start";
const ROUND_FREEZE_END: &str = "round_freeze_end";
const ROUND_END: &str = "round_end";
const MATCH_END: &str = "cs_win_panel_match";
const BOMB_PLANTED: &str = "bomb_planted";
const BOMB_DEFUSED: &str = "bomb_defused";
const PLAYER_HURT: &str = "player_hurt";
const PLAYER_DEATH: &str = "player_death";

/// Two `round_end` events this close together are two reports of the same round end.
const SAME_ROUND_END_TICKS: i32 = 64;

/// A death by one of these is nobody's kill, whoever the event names as the attacker (the game names the victim).
const WORLD_WEAPONS: [&str; 4] = ["world", "worldspawn", "planted_c4", "trigger_hurt"];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Side {
    Ct,
    T,
}

impl Side {
    pub fn as_str(self) -> &'static str {
        match self {
            Side::Ct => "CT",
            Side::T => "T",
        }
    }

    /// The team number of the game: 2 is the terrorists, 3 the counter-terrorists, anything else is not playing.
    fn from_team_number(team: i64) -> Option<Side> {
        match team {
            2 => Some(Side::T),
            3 => Some(Side::Ct),
            _ => None,
        }
    }
}

#[derive(Debug)]
pub struct Facts {
    pub tick_rate: i32,
    pub map_name: Option<String>,
    /// The name each SteamID plays under in the demo.
    pub player_names: HashMap<u64, String>,
    /// At least one, in the order they were played; the tick ranges do not overlap.
    pub rounds: Vec<Round>,
    /// Who played each round, in the order of the rounds; a player is there once per round. Taken from the sampled
    /// positions, so a demo without usable positions has none.
    pub round_players: Vec<RoundPlayer>,
    pub kills: Vec<Kill>,
    pub damages: Vec<Damage>,
    pub positions: Vec<Position>,
}

/// One counted round. Warmup rounds, and rounds that were played again after a restart, are not counted.
#[derive(Debug)]
pub struct Round {
    /// 1 for the first round of the match; overtime continues the count.
    pub round_number: i32,
    pub winner_side: Option<Side>,
    pub win_reason: Option<String>,
    /// The tick the freeze time ended, that is, the round went live.
    pub start_tick: i32,
    /// The tick the round was decided: that of the `round_end` that closed it. Never before `start_tick` or after
    /// `end_tick`.
    pub decided_tick: i32,
    /// The last tick before the next round starts: the seconds after the round is decided belong to it, because the
    /// game still counts the kills made then.
    pub end_tick: i32,
    pub bomb_planted_tick: Option<i32>,
    pub bomb_defused_tick: Option<i32>,
    pub defuser_steam_id: Option<u64>,
}

/// A player who played a counted round, and the side the player was on in it.
#[derive(Debug)]
pub struct RoundPlayer {
    pub round_number: i32,
    pub steam_id: u64,
    pub side: Side,
}

#[derive(Debug)]
pub struct Kill {
    pub round_number: i32,
    pub tick: i32,
    /// Absent when the world or the bomb killed the victim.
    pub killer_steam_id: Option<u64>,
    pub victim_steam_id: u64,
    pub assister_steam_id: Option<u64>,
    pub weapon: String,
    pub headshot: bool,
    /// The bullet went through at least one surface.
    pub wallbang: bool,
    pub noscope: bool,
    pub thrusmoke: bool,
    pub attacker_blind: bool,
    /// The sides as of the tick of the kill: players swap sides at halftime and in overtime.
    pub killer_side: Option<Side>,
    pub victim_side: Option<Side>,
    pub killer_x: Option<f32>,
    pub killer_y: Option<f32>,
    pub victim_x: Option<f32>,
    pub victim_y: Option<f32>,
}

/// Damage to a teammate or to oneself is a fact like any other.
#[derive(Debug)]
pub struct Damage {
    pub round_number: i32,
    pub tick: i32,
    /// Absent when the world or the bomb did the damage.
    pub attacker_steam_id: Option<u64>,
    pub victim_steam_id: u64,
    pub weapon: Option<String>,
    pub damage_health: i32,
    pub damage_armor: i32,
}

/// Where a living player stood at a sampled tick of a counted round.
#[derive(Debug)]
pub struct Position {
    pub tick: i32,
    pub steam_id: u64,
    pub side: Side,
    pub x: f32,
    pub y: f32,
}

#[derive(Debug)]
pub enum ParseError {
    /// The file is not a CS2 demo, the parser could not make sense of it, or it holds no completed round. The text
    /// is for the log.
    NotADemo(String),
    /// The file could not be opened or mapped.
    Io(io::Error),
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            ParseError::NotADemo(detail) => write!(f, "not a readable CS2 demo: {detail}"),
            ParseError::Io(e) => write!(f, "the demo file could not be read: {e}"),
        }
    }
}

/// Reads the decompressed demo at `path`.
///
/// This blocks and uses every core. The parser crate is written for well-formed demos and may panic on a corrupt one,
/// so call it from a blocking task and treat a panic as a failed parse.
pub fn parse_demo(path: &Path) -> Result<Facts, ParseError> {
    let file = File::open(path).map_err(ParseError::Io)?;
    let length = file.metadata().map_err(ParseError::Io)?.len();
    if length < DEMO_HEADER_LEN as u64 {
        return Err(ParseError::NotADemo(format!(
            "the file has only {length} bytes"
        )));
    }
    // SAFETY: the file is a temporary file of this process that nothing writes to while it is mapped.
    let bytes = unsafe { Mmap::map(&file) }.map_err(ParseError::Io)?;
    if &bytes[..DEMO_MAGIC.len()] != DEMO_MAGIC {
        return Err(ParseError::NotADemo(
            "the file does not start with PBDEMS2".to_string(),
        ));
    }

    let huffman = create_huffman_lookup_table();

    let mut output = run(
        &bytes,
        &huffman,
        &["X", "Y", "team_num"],
        &EVENT_NAMES,
        vec![],
    )?;
    let mut events = std::mem::take(&mut output.game_events);
    // Stable, so events of one tick keep the order the demo has them in, apart from the few that have to be seen
    // in a fixed order to tell where a round begins and ends.
    events.sort_by_key(|event| (event.tick, order_in_tick(&event.name)));

    let rounds = rounds_of(&events);
    if rounds.is_empty() {
        // An aborted match, a recording of the warmup only, or one cut off before its first round ended. Passing it
        // on as parsed, with no facts, would replace what an earlier, good parse of the match has stored with nothing.
        return Err(ParseError::NotADemo("no completed round".to_string()));
    }
    let mut player_names = HashMap::new();
    let (kills, damages) = kills_and_damages(&events, &rounds, &mut player_names);
    remember_roster(&output, &mut player_names);
    let map_name = output
        .header
        .as_ref()
        .and_then(|header| header.get("map_name"))
        .map(|name| truncated(name.trim(), MAX_MAP_NAME_CHARS))
        .filter(|name| !name.is_empty());
    drop(events);
    drop(output);

    let positions = positions_of(&bytes, &huffman, &rounds)?;
    let round_players = round_players_of(&positions, &rounds);

    Ok(Facts {
        tick_rate: tick_rate(&bytes).unwrap_or(DEFAULT_TICK_RATE),
        map_name,
        player_names,
        rounds,
        round_players,
        kills,
        damages,
        positions,
    })
}

const EVENT_NAMES: [&str; 8] = [
    ROUND_START,
    ROUND_FREEZE_END,
    ROUND_END,
    MATCH_END,
    BOMB_PLANTED,
    BOMB_DEFUSED,
    PLAYER_HURT,
    PLAYER_DEATH,
];

/// The state of the game rules that every event is asked to carry.
const RULES_PROPS: [&str; 2] = ["is_warmup_period", "total_rounds_played"];

/// One pass of the parser crate over the demo. With `events` it collects those game events, each with `player_props`
/// of the players it names and the game rules; without, it collects `player_props` of every player at `ticks`.
fn run(
    bytes: &[u8],
    huffman: &Vec<(u8, u8)>,
    player_props: &[&str],
    events: &[&str],
    ticks: Vec<i32>,
) -> Result<DemoOutput, ParseError> {
    let owned = |names: &[&str]| {
        names
            .iter()
            .map(|name| name.to_string())
            .collect::<Vec<String>>()
    };
    let player_names = owned(player_props);
    let rules_names = if events.is_empty() {
        vec![]
    } else {
        owned(&RULES_PROPS)
    };
    // The crate knows a property by its name in the game ("CCSPlayerPawn.m_iTeamNum") and labels its output with
    // the short name it is given back here ("team_num").
    let player_real = rm_user_friendly_names(&player_names).map_err(not_a_demo)?;
    let rules_real = rm_user_friendly_names(&rules_names).map_err(not_a_demo)?;
    let mut short_names = AHashMap::default();
    for (real, short) in player_real
        .iter()
        .zip(&player_names)
        .chain(rules_real.iter().zip(&rules_names))
    {
        short_names.insert(real.clone(), short.clone());
    }

    let inputs = ParserInputs {
        real_name_to_og_name: short_names,
        wanted_players: vec![],
        wanted_player_props: player_real,
        wanted_other_props: rules_real,
        wanted_prop_states: AHashMap::default(),
        wanted_ticks: ticks,
        wanted_events: owned(events),
        parse_ents: true,
        parse_projectiles: false,
        parse_grenades: false,
        only_header: false,
        only_convars: false,
        huffman_lookup_table: huffman,
        order_by_steamid: false,
        list_props: false,
        fallback_bytes: None,
    };
    Parser::new(inputs, ParsingMode::Normal)
        .parse_demo(bytes)
        .map_err(not_a_demo)
}

fn not_a_demo(error: impl fmt::Display) -> ParseError {
    ParseError::NotADemo(error.to_string())
}

/// Where an event goes among the events of its tick when the order decides something: a round starts before it goes
/// live, and a bomb is defused before the round it ends is over.
fn order_in_tick(name: &str) -> u8 {
    match name {
        ROUND_START => 0,
        ROUND_FREEZE_END => 1,
        BOMB_PLANTED => 2,
        BOMB_DEFUSED => 3,
        ROUND_END => 5,
        MATCH_END => 6,
        _ => 4,
    }
}

/// The fields of one game event. Besides its own fields an event has `tick`, the game rules, and for each player
/// field (`user`, `attacker`, `assister`) the entries `<player>_steamid`, `<player>_name` and one per player property.
struct Fields<'a>(&'a GameEvent);

impl<'a> Fields<'a> {
    fn get(&self, name: &str) -> Option<&'a Variant> {
        self.0
            .fields
            .iter()
            .find(|field| field.name == name)
            .and_then(|field| field.data.as_ref())
    }

    fn int(&self, name: &str) -> Option<i64> {
        match self.get(name)? {
            Variant::I32(value) => Some(i64::from(*value)),
            Variant::U32(value) => Some(i64::from(*value)),
            Variant::U64(value) => i64::try_from(*value).ok(),
            _ => None,
        }
    }

    fn flag(&self, name: &str) -> bool {
        matches!(self.get(name), Some(Variant::Bool(true)))
    }

    fn float(&self, name: &str) -> Option<f32> {
        match self.get(name)? {
            Variant::F32(value) if value.is_finite() => Some(*value),
            _ => None,
        }
    }

    fn text(&self, name: &str) -> Option<&'a str> {
        match self.get(name)? {
            Variant::String(value) => Some(value.as_str()),
            _ => None,
        }
    }

    /// The SteamID of the player in the field `player`; bots and the world have none.
    fn steam_id(&self, player: &str) -> Option<u64> {
        let id = match self.get(&format!("{player}_steamid"))? {
            Variant::String(value) => value.parse::<u64>().ok()?,
            Variant::U64(value) => *value,
            _ => return None,
        };
        (id != 0).then_some(id)
    }

    fn side(&self, player: &str) -> Option<Side> {
        Side::from_team_number(self.int(&format!("{player}_team_num"))?)
    }

    fn position(&self, player: &str) -> (Option<f32>, Option<f32>) {
        (
            self.float(&format!("{player}_X")),
            self.float(&format!("{player}_Y")),
        )
    }

    fn name(&self, player: &str) -> Option<&'a str> {
        self.text(&format!("{player}_name"))
    }

    fn rounds_played(&self) -> Option<i32> {
        self.int("total_rounds_played")
            .and_then(|rounds| i32::try_from(rounds).ok())
    }
}

/// What has been seen of the round in play since it started.
#[derive(Default)]
struct OpenRound {
    /// The tick of its `round_start`: the freeze time begins.
    started: Option<i32>,
    /// The tick of its `round_freeze_end`: the round goes live.
    live: Option<i32>,
    /// How many rounds had been played when it started.
    rounds_played: Option<i32>,
    bomb_planted: Option<i32>,
    bomb_defused: Option<i32>,
    defuser: Option<u64>,
    /// The tick of its `round_end`; what follows, until the next round starts, is the time after the round.
    decided_at: Option<i32>,
}

/// Finds the counted rounds in the events, which are in tick order.
///
/// A round is counted when its `round_end` arrives outside the warmup. Its number is one more than the rounds the
/// game had played when the round started, so a match that is restarted (a knife round and then the real match, or a
/// round rolled back by an admin) is handled by forgetting the rounds that are played again. A round runs from the
/// end of its freeze time to the tick before the next round starts; the last round ends when the match does.
fn rounds_of(events: &[GameEvent]) -> Vec<Round> {
    let mut rounds: Vec<Round> = Vec::new();
    let mut open = OpenRound::default();
    // The last counted round still waits for the start of the next one to learn where it ends.
    let mut last_is_unclosed = false;

    for event in events {
        let fields = Fields(event);
        match event.name.as_str() {
            ROUND_START => {
                if last_is_unclosed {
                    if let Some(last) = rounds.last_mut() {
                        last.end_tick = last.end_tick.max(event.tick - 1);
                    }
                    last_is_unclosed = false;
                }
                // Also when the round in play has not ended: it is being started again.
                open = OpenRound {
                    started: Some(event.tick),
                    rounds_played: fields.rounds_played(),
                    ..OpenRound::default()
                };
            }
            ROUND_FREEZE_END => {
                if open.decided_at.is_some() {
                    // A round that goes live without having been announced.
                    open = OpenRound::default();
                    last_is_unclosed = false;
                }
                open.live = Some(event.tick);
                if let Some(rounds_played) = fields.rounds_played() {
                    open.rounds_played = Some(rounds_played);
                }
            }
            BOMB_PLANTED if open.decided_at.is_none() => {
                open.bomb_planted.get_or_insert(event.tick);
            }
            BOMB_DEFUSED if open.decided_at.is_none() => {
                open.bomb_defused = Some(event.tick);
                open.defuser = fields.steam_id("user");
            }
            ROUND_END => {
                if fields.flag("is_warmup_period") {
                    open = OpenRound::default();
                    continue;
                }
                let (winner_side, win_reason) = round_result(&fields);
                if let Some(decided_at) = open.decided_at {
                    if event.tick <= decided_at.saturating_add(SAME_ROUND_END_TICKS) {
                        // The same round end reported twice (a demo can carry the game event and also be given
                        // the one made up from the game rules): keep the first, whose tick is the one the round
                        // was decided at, and take from the second what it lacks.
                        if let Some(last) = rounds.last_mut() {
                            last.winner_side = last.winner_side.or(winner_side);
                            last.win_reason = last.win_reason.take().or(win_reason);
                        }
                        continue;
                    }
                    // Another round has ended without a sign of having started: it began where the last one ended.
                    open = OpenRound::default();
                }
                let previous = rounds
                    .last()
                    .map(|round| (round.round_number, round.end_tick));
                let round_number = open
                    .rounds_played
                    .or_else(|| fields.rounds_played())
                    .map(|rounds_played| rounds_played + 1)
                    .or(previous.map(|(number, _)| number + 1))
                    .unwrap_or(1)
                    .max(1);
                // This round, or a later one, was counted before: the match went back and plays it again.
                rounds.retain(|round| round.round_number < round_number);
                let earliest = rounds.last().map_or(0, |round| round.end_tick + 1);
                let start_tick = open
                    .live
                    .or(open.started)
                    .unwrap_or(earliest)
                    .clamp(earliest.min(event.tick), event.tick);
                rounds.push(Round {
                    round_number,
                    winner_side,
                    win_reason,
                    start_tick,
                    decided_tick: event.tick,
                    // Moved on once the start of the next round, or the end of the match, is seen.
                    end_tick: event.tick,
                    bomb_planted_tick: open.bomb_planted,
                    bomb_defused_tick: open.bomb_defused,
                    defuser_steam_id: open.defuser,
                });
                open.decided_at = Some(event.tick);
                last_is_unclosed = true;
            }
            MATCH_END if last_is_unclosed => {
                if let Some(last) = rounds.last_mut() {
                    last.end_tick = last.end_tick.max(event.tick);
                }
                last_is_unclosed = false;
            }
            _ => {}
        }
    }
    rounds
}

/// The winner and the reason of a `round_end`. The game event has them as numbers (the team number and a reason
/// code); the event the parser crate makes up for demos without it has them as text ("CT", "bomb_defused").
fn round_result(fields: &Fields) -> (Option<Side>, Option<String>) {
    let winner = match fields.get("winner") {
        Some(Variant::String(side)) => match side.as_str() {
            "CT" => Some(Side::Ct),
            "T" => Some(Side::T),
            _ => None,
        },
        Some(_) => fields.int("winner").and_then(Side::from_team_number),
        None => None,
    };
    let reason = match fields.get("reason") {
        Some(Variant::String(reason)) => Some(reason.clone()),
        Some(_) => fields.int("reason").map(|code| {
            i32::try_from(code)
                .ok()
                .and_then(|code| ROUND_WIN_REASON.get(&code))
                .map_or_else(|| code.to_string(), |name| name.to_string())
        }),
        None => None,
    };
    (
        winner,
        reason
            .map(|reason| truncated(&reason, MAX_WIN_REASON_CHARS))
            .filter(|reason| !reason.is_empty()),
    )
}

/// The counted round whose tick range contains `tick`.
fn round_at(rounds: &[Round], tick: i32) -> Option<&Round> {
    let after = rounds.partition_point(|round| round.start_tick <= tick);
    rounds[..after]
        .last()
        .filter(|round| tick <= round.end_tick)
}

/// The kills and damages that happened in a counted round; the rest (warmup, the time between rounds) is dropped.
/// The names of the players involved are added to `player_names`.
fn kills_and_damages(
    events: &[GameEvent],
    rounds: &[Round],
    player_names: &mut HashMap<u64, String>,
) -> (Vec<Kill>, Vec<Damage>) {
    let mut kills = Vec::new();
    let mut damages = Vec::new();
    let mut outside_rounds = 0usize;
    let mut without_victim = 0usize;

    for event in events {
        let is_kill = event.name == PLAYER_DEATH;
        if !is_kill && event.name != PLAYER_HURT {
            continue;
        }
        let Some(round) = round_at(rounds, event.tick) else {
            outside_rounds += 1;
            continue;
        };
        let fields = Fields(event);
        // A bot has no SteamID, and neither has a player the parser lost track of.
        let Some(victim) = fields.steam_id("user") else {
            without_victim += 1;
            continue;
        };
        let weapon = fields
            .text("weapon")
            .map(str::trim)
            .filter(|weapon| !weapon.is_empty());
        let by_world = weapon.is_some_and(|weapon| WORLD_WEAPONS.contains(&weapon));
        let attacker = if by_world {
            None
        } else {
            fields.steam_id("attacker")
        };

        remember_name(player_names, Some(victim), fields.name("user"));
        remember_name(player_names, attacker, fields.name("attacker"));

        if is_kill {
            let assister = fields.steam_id("assister");
            remember_name(player_names, assister, fields.name("assister"));
            let (killer_x, killer_y) = if attacker.is_some() {
                fields.position("attacker")
            } else {
                (None, None)
            };
            let (victim_x, victim_y) = fields.position("user");
            kills.push(Kill {
                round_number: round.round_number,
                tick: event.tick,
                killer_steam_id: attacker,
                victim_steam_id: victim,
                assister_steam_id: assister,
                weapon: truncated(weapon.unwrap_or("unknown"), MAX_WEAPON_CHARS),
                headshot: fields.flag("headshot"),
                wallbang: fields
                    .int("penetrated")
                    .is_some_and(|surfaces| surfaces > 0),
                noscope: fields.flag("noscope"),
                thrusmoke: fields.flag("thrusmoke"),
                attacker_blind: fields.flag("attackerblind"),
                killer_side: attacker.and_then(|_| fields.side("attacker")),
                victim_side: fields.side("user"),
                killer_x,
                killer_y,
                victim_x,
                victim_y,
            });
        } else {
            damages.push(Damage {
                round_number: round.round_number,
                tick: event.tick,
                attacker_steam_id: attacker,
                victim_steam_id: victim,
                weapon: weapon.map(|weapon| truncated(weapon, MAX_WEAPON_CHARS)),
                damage_health: amount(fields.int("dmg_health")),
                damage_armor: amount(fields.int("dmg_armor")),
            });
        }
    }
    debug!(
        outside_rounds,
        without_victim, "kill and damage events that were not counted"
    );
    (kills, damages)
}

fn amount(value: Option<i64>) -> i32 {
    value.map_or(0, |value| value.clamp(0, i64::from(i32::MAX)) as i32)
}

fn remember_name(names: &mut HashMap<u64, String>, steam_id: Option<u64>, name: Option<&str>) {
    if let (Some(steam_id), Some(name)) = (steam_id, name) {
        if !name.trim().is_empty() {
            names.entry(steam_id).or_insert_with(|| name.to_string());
        }
    }
}

/// The names of the players the demo lists, for those no event has named.
fn remember_roster(output: &DemoOutput, names: &mut HashMap<u64, String>) {
    for player in output.player_md.iter().chain(&output.roster) {
        remember_name(
            names,
            player.steamid.filter(|id| *id != 0),
            player.name.as_deref(),
        );
    }
}

/// Where the living players stood, every [`POSITION_SAMPLE_TICKS`] ticks of every counted round.
fn positions_of(
    bytes: &[u8],
    huffman: &Vec<(u8, u8)>,
    rounds: &[Round],
) -> Result<Vec<Position>, ParseError> {
    let mut ticks = Vec::new();
    for round in rounds {
        let first =
            round.start_tick.max(0).div_euclid(POSITION_SAMPLE_TICKS) * POSITION_SAMPLE_TICKS;
        ticks.extend(
            (first..=round.end_tick)
                .step_by(POSITION_SAMPLE_TICKS as usize)
                .filter(|tick| *tick >= round.start_tick),
        );
    }
    if ticks.is_empty() {
        return Ok(vec![]);
    }

    let output = run(
        bytes,
        huffman,
        &["X", "Y", "team_num", "is_alive"],
        &[],
        ticks,
    )?;
    // The values come as columns of equal length, one row per player and tick.
    let column = |name: &str| {
        let info = output
            .prop_controller
            .prop_infos
            .iter()
            .find(|info| info.prop_friendly_name == name)?;
        output.df.get(&info.id)?.data.as_ref()
    };
    let (
        Some(VarVec::I32(ticks)),
        Some(VarVec::U64(steam_ids)),
        Some(VarVec::U32(teams)),
        Some(VarVec::Bool(alive)),
        Some(VarVec::F32(xs)),
        Some(VarVec::F32(ys)),
    ) = (
        column("tick"),
        column("steamid"),
        column("team_num"),
        column("is_alive"),
        column("X"),
        column("Y"),
    )
    else {
        // The demo is parsed all the same, with its rounds, kills and damages.
        warn!("the demo has no usable player positions: it gets no movement heat bins and no round players");
        return Ok(vec![]);
    };
    let rows = ticks
        .len()
        .min(steam_ids.len())
        .min(teams.len())
        .min(alive.len())
        .min(xs.len())
        .min(ys.len());

    let mut positions = Vec::new();
    for row in 0..rows {
        let (Some(tick), Some(steam_id), Some(team), Some(true), Some(x), Some(y)) = (
            ticks[row],
            steam_ids[row],
            teams[row],
            alive[row],
            xs[row],
            ys[row],
        ) else {
            continue;
        };
        let Some(side) = Side::from_team_number(i64::from(team)) else {
            continue;
        };
        if steam_id == 0 || !x.is_finite() || !y.is_finite() || round_at(rounds, tick).is_none() {
            continue;
        }
        positions.push(Position {
            tick,
            steam_id,
            side,
            x,
            y,
        });
    }
    Ok(positions)
}

/// Who played each counted round, and on which side: every player that has a sampled position in the round, with the
/// side of the earliest one. In the order of the rounds and, within a round, of the SteamIDs.
///
/// Only the living are sampled, so a player who died before the first sampled tick of a round is not among its
/// players, and a round too short to hold a sampled tick has none.
fn round_players_of(positions: &[Position], rounds: &[Round]) -> Vec<RoundPlayer> {
    // Per round and player, the earliest sampled tick the player is seen at and the side then. The rows are not
    // relied on to come in tick order.
    let mut first_seen: BTreeMap<(i32, u64), (i32, Side)> = BTreeMap::new();
    let mut on_both_sides: BTreeSet<(i32, u64)> = BTreeSet::new();
    for position in positions {
        let Some(round) = round_at(rounds, position.tick) else {
            continue;
        };
        let key = (round.round_number, position.steam_id);
        match first_seen.entry(key) {
            Entry::Vacant(entry) => {
                entry.insert((position.tick, position.side));
            }
            Entry::Occupied(mut entry) => {
                let (tick, side) = *entry.get();
                if position.side != side {
                    on_both_sides.insert(key);
                }
                if position.tick < tick {
                    entry.insert((position.tick, position.side));
                }
            }
        }
    }
    debug!(
        round_players = first_seen.len(),
        on_both_sides = on_both_sides.len(),
        "round players taken from the sampled positions; a player seen on both sides in a round keeps the first"
    );
    first_seen
        .into_iter()
        .map(|((round_number, steam_id), (_, side))| RoundPlayer {
            round_number,
            steam_id,
            side,
        })
        .collect()
}

/// The tick rate, from the file information the demo header points to: the ticks played divided by the seconds played.
/// A demo whose recording was cut short has no file information.
fn tick_rate(bytes: &[u8]) -> Option<i32> {
    let offset = usize::try_from(i32::from_le_bytes(bytes.get(8..12)?.try_into().ok()?)).ok()?;
    if offset < DEMO_HEADER_LEN {
        return None;
    }
    let mut position = offset;
    let command = varint(bytes, &mut position)?;
    let _tick = varint(bytes, &mut position)?;
    let size = usize::try_from(varint(bytes, &mut position)?).ok()?;
    // A compressed command has another number; the few bytes of the file information never are.
    if command != DEM_FILE_INFO {
        return None;
    }
    let info =
        csgoproto::CDemoFileInfo::decode(bytes.get(position..position.checked_add(size)?)?).ok()?;
    let seconds = f64::from(info.playback_time?);
    let ticks = f64::from(info.playback_ticks?);
    if seconds <= 0.0 || ticks <= 0.0 {
        return None;
    }
    let rate = (ticks / seconds).round();
    (1.0..=1024.0).contains(&rate).then_some(rate as i32)
}

/// A protobuf varint of at most 32 bits at `position`, which is moved past it.
fn varint(bytes: &[u8], position: &mut usize) -> Option<u32> {
    let mut value: u32 = 0;
    for shift in (0..35).step_by(7) {
        let byte = *bytes.get(*position)?;
        *position += 1;
        value |= u32::from(byte & 0x7f).checked_shl(shift)?;
        if byte & 0x80 == 0 {
            return Some(value);
        }
    }
    None
}

/// At most `max_chars` characters of `text`, without the NUL characters PostgreSQL does not store.
pub fn truncated(text: &str, max_chars: usize) -> String {
    text.chars()
        .filter(|c| *c != '\0')
        .take(max_chars)
        .collect()
}
