package io.csfaceit.backend.player;

import static org.assertj.core.api.Assertions.assertThat;

import io.csfaceit.backend.AbstractIntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

class PlayerRepositoryTest extends AbstractIntegrationTest {

    @Autowired
    PlayerRepository players;

    @Test
    void savesAndFindsByFaceitId() {
        players.save(new Player("f-1", "s1mple", 3500, 10));

        assertThat(players.findByFaceitId("f-1"))
                .get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
        Player found = players.findByFaceitId("f-1").orElseThrow();
        assertThat(found.getId()).isNotNull();
        assertThat(found.getCreatedAt()).isNotNull();
        assertThat(found.getUpdatedAt()).isNotNull();
    }

    @Test
    void updateRefreshesUpdatedAtAndKeepsCreatedAt() {
        players.save(new Player("f-1", "s1mple", 3500, 10));
        Player before = players.findByFaceitId("f-1").orElseThrow();

        before.setElo(3600);
        players.saveAndFlush(before);

        Player after = players.findByFaceitId("f-1").orElseThrow();
        assertThat(after.getElo()).isEqualTo(3600);
        assertThat(after.getCreatedAt()).isEqualTo(before.getCreatedAt());
        assertThat(after.getUpdatedAt()).isAfter(before.getUpdatedAt());
    }
}
