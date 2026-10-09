package io.csfaceit.backend.match;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** FACEIT sends every statistic as a string; the parsing helpers must never fail a request over a bad value. */
class MatchServiceTest {

    @Test
    void intStatParsesAValidValue() {
        assertThat(MatchService.intStat(Map.of("Kills", "25"), "Kills")).isEqualTo(25);
        assertThat(MatchService.intStat(Map.of("Kills", " 25 "), "Kills")).isEqualTo(25);
    }

    @Test
    void intStatIsZeroForAMissingKey() {
        assertThat(MatchService.intStat(Map.of("Deaths", "14"), "Kills")).isZero();
    }

    @Test
    void intStatIsZeroWhenTheWholeMapIsMissing() {
        assertThat(MatchService.intStat(null, "Kills")).isZero();
    }

    @Test
    void intStatIsZeroForANullValue() {
        Map<String, String> stats = new HashMap<>();
        stats.put("Kills", null);

        assertThat(MatchService.intStat(stats, "Kills")).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "abc", "1.5", "99999999999", "12 / 9"})
    void intStatIsZeroForAnEmptyOrNonNumericValue(String value) {
        assertThat(MatchService.intStat(Map.of("Kills", value), "Kills")).isZero();
    }

    @Test
    void doubleStatParsesAValidValue() {
        assertThat(MatchService.doubleStat(Map.of("ADR", "95.4"), "ADR")).isEqualTo(95.4);
        assertThat(MatchService.doubleStat(Map.of("K/D Ratio", "1"), "K/D Ratio")).isEqualTo(1.0);
    }

    @Test
    void doubleStatIsZeroForAMissingKey() {
        assertThat(MatchService.doubleStat(Map.of("ADR", "95.4"), "K/R Ratio")).isZero();
    }

    @Test
    void doubleStatIsZeroWhenTheWholeMapIsMissing() {
        assertThat(MatchService.doubleStat(null, "ADR")).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "   ", "abc", "1,5", "NaN", "Infinity", "-Infinity"})
    void doubleStatIsZeroForAnEmptyNonNumericOrNonFiniteValue(String value) {
        assertThat(MatchService.doubleStat(Map.of("ADR", value), "ADR")).isZero();
    }
}
