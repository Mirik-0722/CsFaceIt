package io.csfaceit.backend.match;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.player.Player;
import io.csfaceit.backend.player.PlayerRepository;
import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

class PlayerMatchStatsRepositoryTest extends AbstractIntegrationTest {

    @Autowired
    PlayerRepository players;

    @Autowired
    MatchRepository matches;

    @Autowired
    PlayerMatchStatsRepository stats;

    @Test
    void uniqueOnPlayerAndMatch() {
        Player player = players.save(new Player("f-1", "s1mple", 3500, 10));
        Match match = matches.save(newMatch("m-1"));
        stats.saveAndFlush(new PlayerMatchStats(player, match));

        assertThatThrownBy(() -> stats.saveAndFlush(new PlayerMatchStats(player, match)))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void findByPlayerIdAndMatchIdReturnsRow() {
        Player player = players.save(new Player("f-1", "s1mple", 3500, 10));
        Player otherPlayer = players.save(new Player("f-2", "ZywOo", 3400, 10));
        Match match = matches.save(newMatch("m-1"));
        Match otherMatch = matches.save(newMatch("m-2"));

        PlayerMatchStats row = new PlayerMatchStats(player, match);
        row.setKills(25);
        row.setDeaths(14);
        row.setAssists(5);
        row.setHeadshots(12);
        row.setAdr(new BigDecimal("98.50"));
        row.setKast(new BigDecimal("76.25"));
        row.setRating(new BigDecimal("1.35"));
        stats.save(row);
        stats.save(new PlayerMatchStats(otherPlayer, match));
        stats.save(new PlayerMatchStats(player, otherMatch));

        PlayerMatchStats found = stats.findByPlayerIdAndMatchId(player.getId(), match.getId()).orElseThrow();

        assertThat(found.getId()).isEqualTo(row.getId());
        assertThat(found.getPlayer().getId()).isEqualTo(player.getId());
        assertThat(found.getMatch().getId()).isEqualTo(match.getId());
        assertThat(found.getKills()).isEqualTo(25);
        assertThat(found.getDeaths()).isEqualTo(14);
        assertThat(found.getAssists()).isEqualTo(5);
        assertThat(found.getHeadshots()).isEqualTo(12);
        assertThat(found.getAdr()).isEqualByComparingTo("98.50");
        assertThat(found.getKast()).isEqualByComparingTo("76.25");
        assertThat(found.getRating()).isEqualByComparingTo("1.35");
        assertThat(stats.findByPlayerIdAndMatchId(otherPlayer.getId(), otherMatch.getId())).isEmpty();
    }

    private static Match newMatch(String faceitMatchId) {
        Instant finishedAt = Instant.parse("2026-10-08T12:00:00Z");
        return new Match(faceitMatchId, "de_mirage", finishedAt.minusSeconds(2400), finishedAt);
    }
}
