package io.csfaceit.backend;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

class SchemaMigrationTest extends AbstractIntegrationTest {

    @Autowired
    JdbcTemplate jdbc;

    @Test
    void flywayCreatesFourBaseTables() {
        List<String> tables = jdbc.queryForList(
                "select table_name from information_schema.tables where table_schema='public' order by 1", String.class);
        assertThat(tables).contains("players", "matches", "player_match_stats", "highlights", "flyway_schema_history");
    }
}
