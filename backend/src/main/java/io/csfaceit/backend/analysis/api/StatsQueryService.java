package io.csfaceit.backend.analysis.api;

import io.csfaceit.backend.analysis.api.dto.PlayerAggregateStatsResponse;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.sql.ResultSet;
import java.sql.SQLException;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * A player's statistics over all the matches the backend has a row of his for ({@code player_match_stats}). One
 * statement adds the rows up, and the figures are worked out from the sums here, in exact decimal arithmetic, so that
 * a figure is rounded once and only once. Only the database is read.
 *
 * <ul>
 *   <li>{@code winRate}: the share of the matches with a known result that the player's team won, in percent.
 *   <li>{@code kd}: all kills over all deaths (over 1 for a player who never died); {@code hsPercent}: the share of the
 *       kills that were headshots. Both use every row, FACEIT's own numbers included.
 *   <li>{@code adr}: the mean of the stored per-match ADR, which is the damage per round of each match, not weighted by
 *       the rounds.
 *   <li>{@code kast}: the KAST of the matches analyzed from a demo, each weighted by the rounds the player played in
 *       it, so it is the share of all the rounds played.
 *   <li>{@code entryKillsPerMatch} and {@code tradeKillsPerMatch}: the entry kills and the trade kills over the matches
 *       that were analyzed.
 *   <li>{@code clutchPercent}: the clutches won over the clutches played, in percent.
 * </ul>
 */
@Service
public class StatsQueryService {

    private static final int PERCENT = 100;
    private static final int PERCENT_SCALE = 1;
    private static final int ADR_SCALE = 1;
    private static final int RATIO_SCALE = 2;

    /**
     * One row of sums, also for a player with no rows: {@code count} gives 0 and {@code coalesce} turns the sums of
     * nothing into 0, while {@code adr} stays null when no row has an ADR. {@code known_results} are the rows whose
     * {@code won} is set (true or false), {@code wins} those where it is true. The KAST of a row counts only together
     * with its {@code rounds_played}, so a KAST that is not weighted by anything never enters the figure.
     */
    private static final String TOTALS_SQL = """
            SELECT count(*) AS matches,
                   count(s.rounds_played) AS analyzed_matches,
                   count(s.won) AS known_results,
                   count(*) FILTER (WHERE s.won) AS wins,
                   coalesce(sum(s.kills), 0) AS kills,
                   coalesce(sum(s.deaths), 0) AS deaths,
                   coalesce(sum(s.headshots), 0) AS headshots,
                   avg(s.adr) AS adr,
                   coalesce(sum(s.kast * s.rounds_played), 0) AS kast_weighted,
                   coalesce(sum(s.rounds_played) FILTER (WHERE s.kast IS NOT NULL), 0) AS kast_rounds,
                   coalesce(sum(s.entry_kills), 0) AS entry_kills,
                   coalesce(sum(s.trade_kills), 0) AS trade_kills,
                   coalesce(sum(s.clutch_attempts), 0) AS clutch_attempts,
                   coalesce(sum(s.clutch_wins), 0) AS clutch_wins
            FROM player_match_stats s
            JOIN players p ON p.id = s.player_id
            WHERE p.faceit_id = :playerId""";

    private final JdbcClient jdbc;

    public StatsQueryService(JdbcClient jdbc) {
        this.jdbc = jdbc;
    }

    /**
     * The statistics of the player over everything stored for him. A player the database does not know is not an
     * error: he has 0 matches and no figure that needs data.
     *
     * @param faceitPlayerId the FACEIT player id ({@code players.faceit_id}); {@code steam:<SteamID>} for a player
     *                       known only from a demo
     */
    public PlayerAggregateStatsResponse aggregate(String faceitPlayerId) {
        Totals totals = jdbc.sql(TOTALS_SQL).param("playerId", faceitPlayerId).query(StatsQueryService::totals)
                .single();
        return new PlayerAggregateStatsResponse(
                faceitPlayerId,
                Math.toIntExact(totals.matches()),
                Math.toIntExact(totals.analyzedMatches()),
                share(totals.wins(), totals.knownResults()),
                ratio(totals.kills(), Math.max(totals.deaths(), 1), RATIO_SCALE),
                totals.kills() == 0 ? 0.0 : share(totals.headshots(), totals.kills()),
                totals.adr() == null ? null : totals.adr().setScale(ADR_SCALE, RoundingMode.HALF_UP).doubleValue(),
                totals.kastRounds() == 0 ? null
                        : divide(totals.kastWeighted(), BigDecimal.valueOf(totals.kastRounds()), PERCENT_SCALE),
                perMatch(totals.entryKills(), totals.analyzedMatches()),
                perMatch(totals.tradeKills(), totals.analyzedMatches()),
                share(totals.clutchWins(), totals.clutchAttempts()),
                Math.toIntExact(totals.clutchAttempts()),
                Math.toIntExact(totals.clutchWins()));
    }

    /** {@code part} of {@code whole} in percent with one decimal; {@code null} when there is no whole to take it of. */
    private static Double share(long part, long whole) {
        if (whole == 0) {
            return null;
        }
        return divide(BigDecimal.valueOf(part).multiply(BigDecimal.valueOf(PERCENT)), BigDecimal.valueOf(whole),
                PERCENT_SCALE);
    }

    /** {@code count} over {@code matches} with two decimals; {@code null} when no match was analyzed. */
    private static Double perMatch(long count, long matches) {
        return matches == 0 ? null : ratio(count, matches, RATIO_SCALE);
    }

    private static double ratio(long numerator, long denominator, int scale) {
        return divide(BigDecimal.valueOf(numerator), BigDecimal.valueOf(denominator), scale);
    }

    private static double divide(BigDecimal numerator, BigDecimal denominator, int scale) {
        return numerator.divide(denominator, scale, RoundingMode.HALF_UP).doubleValue();
    }

    private static Totals totals(ResultSet rs, int rowNumber) throws SQLException {
        return new Totals(rs.getLong("matches"), rs.getLong("analyzed_matches"), rs.getLong("known_results"),
                rs.getLong("wins"), rs.getLong("kills"), rs.getLong("deaths"), rs.getLong("headshots"),
                rs.getBigDecimal("adr"), rs.getBigDecimal("kast_weighted"), rs.getLong("kast_rounds"),
                rs.getLong("entry_kills"), rs.getLong("trade_kills"), rs.getLong("clutch_attempts"),
                rs.getLong("clutch_wins"));
    }

    /** What the statement adds up. */
    private record Totals(long matches, long analyzedMatches, long knownResults, long wins, long kills, long deaths,
                          long headshots, BigDecimal adr, BigDecimal kastWeighted, long kastRounds, long entryKills,
                          long tradeKills, long clutchAttempts, long clutchWins) {
    }
}
