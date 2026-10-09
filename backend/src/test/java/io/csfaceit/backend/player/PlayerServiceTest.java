package io.csfaceit.backend.player;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import io.csfaceit.backend.AbstractIntegrationTest;
import io.csfaceit.backend.faceit.FaceitGateway;
import io.csfaceit.backend.faceit.dto.FaceitGame;
import io.csfaceit.backend.faceit.dto.FaceitPlayer;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;

class PlayerServiceTest extends AbstractIntegrationTest {

    @Autowired
    PlayerService service;

    @Autowired
    PlayerRepository players;

    @Test
    void upsertCreatesPlayerWithCs2EloAndLevel() {
        Player saved = service.upsert(faceitPlayer("f-1", "s1mple", 3500, 10));

        assertThat(saved.getId()).isNotNull();
        assertThat(players.count()).isEqualTo(1);
        assertThat(players.findByFaceitId("f-1")).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
    }

    @Test
    void upsertUpdatesNicknameForExistingFaceitId() {
        service.upsert(faceitPlayer("f-1", "oldNick", 2000, 7));
        service.upsert(faceitPlayer("f-1", "newNick", 2100, 8));

        assertThat(players.count()).isEqualTo(1);
        assertThat(players.findByFaceitId("f-1")).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("newNick", 2100, 8);
    }

    @Test
    void upsertStoresNullEloAndLevelWhenPlayerHasNoCs2Section() {
        service.upsert(faceitPlayer("f-1", "s1mple", 2000, 7));
        service.upsert(new FaceitPlayer("f-1", "s1mple", null, null, Map.of("csgo", new FaceitGame(3200, 10))));

        assertThat(players.findByFaceitId("f-1")).get()
                .extracting(Player::getElo, Player::getLevel)
                .containsExactly(null, null);
    }

    @Test
    void upsertSurvivesAConcurrentInsertOfTheSameFaceitId() {
        PlayerRepository repository = mock(PlayerRepository.class);
        Player winner = new Player("f-1", "winner", 1000, 3);
        when(repository.findByFaceitId("f-1")).thenReturn(Optional.empty(), Optional.of(winner));
        when(repository.saveAndFlush(any(Player.class))).thenThrow(new DataIntegrityViolationException("duplicate"));
        when(repository.save(any(Player.class))).thenAnswer(invocation -> invocation.getArgument(0));
        PlayerService racing = new PlayerService(mock(FaceitGateway.class), repository);

        Player result = racing.upsert(faceitPlayer("f-1", "loser", 2000, 7));

        assertThat(result).isSameAs(winner);
        assertThat(result).extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("loser", 2000, 7);
        verify(repository).save(winner);
    }

    @Test
    void ensurePlayerCreatesPlayerWithoutEloAndLevel() {
        Player created = service.ensurePlayer("f-1", "s1mple");

        assertThat(created.getId()).isNotNull();
        assertThat(players.count()).isEqualTo(1);
        assertThat(players.findByFaceitId("f-1")).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", null, null);
    }

    @Test
    void ensurePlayerLeavesEloAndLevelOfAnExistingPlayerUntouched() {
        service.upsert(faceitPlayer("f-1", "s1mple", 3500, 10));

        Player ensured = service.ensurePlayer("f-1", "s1mple");

        assertThat(ensured.getId()).isNotNull();
        assertThat(players.count()).isEqualTo(1);
        assertThat(players.findByFaceitId("f-1")).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("s1mple", 3500, 10);
    }

    @Test
    void ensurePlayerRefreshesTheNicknameOfAnExistingPlayer() {
        service.upsert(faceitPlayer("f-1", "oldNick", 3500, 10));

        service.ensurePlayer("f-1", "newNick");

        assertThat(players.count()).isEqualTo(1);
        assertThat(players.findByFaceitId("f-1")).get()
                .extracting(Player::getNickname, Player::getElo, Player::getLevel)
                .containsExactly("newNick", 3500, 10);
    }

    private static FaceitPlayer faceitPlayer(String id, String nickname, int elo, int level) {
        return new FaceitPlayer(id, nickname, null, null, Map.of("cs2", new FaceitGame(elo, level)));
    }
}
