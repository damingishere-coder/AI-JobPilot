package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import static org.assertj.core.api.Assertions.assertThat;

class OpportunityMigrationTest {
    @TempDir Path directory;
    @Test void backfillPreservesOrphansAndDoesNotInventHistoricalContext() {
        var source=new DriverManagerDataSource("jdbc:sqlite:"+directory.resolve("legacy.db"));
        Flyway.configure().dataSource(source).locations("classpath:db/migration").target("22").load().migrate();
        var jdbc=new JdbcTemplate(source);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'fixture',1)");
        jdbc.update("INSERT INTO boss_data(profile_id,encrypt_id,job_name) VALUES(1,'valid','known'),(1,'','missing-key'),(999,'orphan','missing-profile')");
        jdbc.update("INSERT INTO delivery_attempt(request_key,platform,profile_id,job_key,job_row_id,state,evidence,requested_at,updated_at) VALUES('legacy','boss',1,'deleted-source',88,'CONFIRMED','LEGACY_STATUS_IMPORT',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),('existing','boss',1,'already-contacted',99,'CONFIRMED','EXISTING_CONVERSATION',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        var flyway=Flyway.configure().dataSource(source).locations("classpath:db/migration").load();
        flyway.migrate(); flyway.migrate();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM boss_data",Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity",Integer.class)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity WHERE profile_id=999 OR job_key=''",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE job_key='deleted-source'",String.class)).isEqualTo("APPLIED");
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity WHERE job_key='already-contacted'",String.class)).isEqualTo("DISCOVERED");
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE occurred_at IS NOT NULL",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE source<>'LEGACY_IMPORT'",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM opportunity_event WHERE json_extract(payload,'$.context') IS NOT NULL",Integer.class)).isZero();
        assertThat(jdbc.queryForObject("PRAGMA integrity_check",String.class)).isEqualTo("ok");
        assertThat(jdbc.queryForList("PRAGMA foreign_key_check")).isEmpty();
    }
}
