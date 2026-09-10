package com.getjobs.application.service;

import com.getjobs.application.init.ZhilianOptionInitializer;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.NONE, properties = {
        "app.auto-open-browser=false",
        "app.browser.initialize-on-startup=false",
        "app.static-server.enabled=false"
})
class BossThresholdReclassificationIntegrationTest {
    private static final Path TEST_ROOT = createTestRoot();

    @DynamicPropertySource
    static void testProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", () -> "jdbc:sqlite:" + TEST_ROOT.resolve("thresholds.db"));
        registry.add("app.paths.data-dir", () -> TEST_ROOT.resolve("data").toString());
        registry.add("app.paths.output-dir", () -> TEST_ROOT.resolve("output").toString());
        registry.add("app.paths.cache-dir", () -> TEST_ROOT.resolve("cache").toString());
        registry.add("app.paths.log-dir", () -> TEST_ROOT.resolve("logs").toString());
        registry.add("logging.file.name", () -> TEST_ROOT.resolve("logs/get-jobs.log").toString());
    }

    @Autowired
    private JobAiAnalysisService jobAiAnalysisService;

    @Autowired
    private ProfileService profileService;

    @Autowired
    private JdbcTemplate jdbcTemplate;

    @MockitoBean
    private ZhilianOptionInitializer zhilianOptionInitializer;

    @Test
    void savingThresholdsPromotesOnlyEligibleCurrentProfileBossRowsAndIsIdempotent() {
        jdbcTemplate.update("UPDATE profile SET is_active=0");
        jdbcTemplate.update("INSERT INTO profile(name, is_active) VALUES ('当前档案', 1)");
        long profileId = profileService.getCurrentProfileId();
        jdbcTemplate.update("INSERT INTO profile(name, is_active) VALUES ('其他档案', 0)");
        long otherProfileId = jdbcTemplate.queryForObject("SELECT MAX(id) FROM profile", Long.class);

        insertBoss(profileId, "normal-pass", DeliveryStatus.AI_NOT_MATCH, 60, "SKIP", 0, "normal-reason");
        insertBoss(profileId, "normal-low", DeliveryStatus.AI_NOT_MATCH, 59, "SKIP", 0, "normal-low-reason");
        insertBoss(profileId, "priority-pass", DeliveryStatus.AI_NOT_MATCH, 50, "SKIP", 1, "priority-reason");
        insertBoss(profileId, "priority-low", DeliveryStatus.AI_NOT_MATCH, 49, "SKIP", 1, "priority-low-reason");
        insertBoss(profileId, "null-score", DeliveryStatus.AI_NOT_MATCH, null, "SKIP", 0, "null-reason");
        insertBoss(profileId, "locked", DeliveryStatus.DELIVERED, 99, "APPLY", 0, "locked-reason");
        insertBoss(profileId, "skipped", DeliveryStatus.SKIPPED, 99, "SKIP", 0, "skipped-reason");
        insertBoss(otherProfileId, "other-profile", DeliveryStatus.AI_NOT_MATCH, 99, "SKIP", 0, "other-reason");
        jdbcTemplate.update("""
                INSERT INTO job_ai_analysis(profile_id, platform, job_key, score, decision, summary)
                VALUES (?, 'boss', 'normal-pass', 60, 'SKIP', '历史分析')
                """, profileId);
        int deliveryAttemptsBefore = jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM delivery_attempt WHERE profile_id=? AND platform='boss'",
                Integer.class,
                profileId
        );

        JobAiAnalysisService.ThresholdApplicationResult first =
                jobAiAnalysisService.saveThresholdsAndPromoteBossHistory(60, 50);
        JobAiAnalysisService.ThresholdApplicationResult second =
                jobAiAnalysisService.saveThresholdsAndPromoteBossHistory(60, 50);

        assertThat(first.bossHistoricalPromotedCount()).isEqualTo(2);
        assertThat(second.bossHistoricalPromotedCount()).isZero();
        assertBoss("normal-pass", DeliveryStatus.WAITING_CONFIRM, "APPLY", "normal-reason");
        assertBoss("priority-pass", DeliveryStatus.WAITING_CONFIRM, "APPLY", "priority-reason");
        assertBoss("normal-low", DeliveryStatus.AI_NOT_MATCH, "SKIP", "normal-low-reason");
        assertBoss("priority-low", DeliveryStatus.AI_NOT_MATCH, "SKIP", "priority-low-reason");
        assertBoss("null-score", DeliveryStatus.AI_NOT_MATCH, "SKIP", "null-reason");
        assertBoss("locked", DeliveryStatus.DELIVERED, "APPLY", "locked-reason");
        assertBoss("skipped", DeliveryStatus.SKIPPED, "SKIP", "skipped-reason");
        assertBoss("other-profile", DeliveryStatus.AI_NOT_MATCH, "SKIP", "other-reason");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT decision FROM job_ai_analysis WHERE profile_id=? AND job_key='normal-pass'",
                String.class,
                profileId
        )).isEqualTo("SKIP");
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM delivery_attempt WHERE profile_id=? AND platform='boss'",
                Integer.class,
                profileId
        )).isEqualTo(deliveryAttemptsBefore);
    }

    @Test
    void bossUpdateFailureRollsBackThresholdSave() {
        jdbcTemplate.update("UPDATE profile SET is_active=0");
        jdbcTemplate.update("INSERT INTO profile(name, is_active) VALUES ('回滚档案', 1)");
        long profileId = profileService.getCurrentProfileId();
        jdbcTemplate.update("""
                INSERT INTO ai(profile_id, apply_threshold, priority_apply_threshold)
                VALUES (?, 75, 65)
                """, profileId);
        insertBoss(profileId, "rollback-row", DeliveryStatus.AI_NOT_MATCH, 80, "SKIP", 0, "rollback-reason");

        jdbcTemplate.execute("""
                CREATE TRIGGER abort_boss_threshold_reclassification
                BEFORE UPDATE ON boss_data
                WHEN OLD.encrypt_id='rollback-row'
                BEGIN
                    SELECT RAISE(ABORT, 'forced rollback');
                END
                """);
        try {
            assertThatThrownBy(() -> jobAiAnalysisService.saveThresholdsAndPromoteBossHistory(60, 50))
                    .isInstanceOf(RuntimeException.class);
        } finally {
            jdbcTemplate.execute("DROP TRIGGER IF EXISTS abort_boss_threshold_reclassification");
        }

        assertThat(jdbcTemplate.queryForObject(
                "SELECT apply_threshold FROM ai WHERE profile_id=?",
                Integer.class,
                profileId
        )).isEqualTo(75);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT priority_apply_threshold FROM ai WHERE profile_id=?",
                Integer.class,
                profileId
        )).isEqualTo(65);
        assertBoss("rollback-row", DeliveryStatus.AI_NOT_MATCH, "SKIP", "rollback-reason");
    }

    private void insertBoss(
            long profileId,
            String encryptId,
            String status,
            Integer score,
            String decision,
            int priorityCompany,
            String reason
    ) {
        jdbcTemplate.update("""
                INSERT INTO boss_data(
                    profile_id, encrypt_id, delivery_status, ai_score, ai_decision,
                    priority_company, ai_reason, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, profileId, encryptId, status, score, decision, priorityCompany, reason);
    }

    private void assertBoss(String encryptId, String status, String decision, String reason) {
        assertThat(jdbcTemplate.queryForObject(
                "SELECT delivery_status FROM boss_data WHERE encrypt_id=?",
                String.class,
                encryptId
        )).isEqualTo(status);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT ai_decision FROM boss_data WHERE encrypt_id=?",
                String.class,
                encryptId
        )).isEqualTo(decision);
        assertThat(jdbcTemplate.queryForObject(
                "SELECT ai_reason FROM boss_data WHERE encrypt_id=?",
                String.class,
                encryptId
        )).isEqualTo(reason);
    }

    private static Path createTestRoot() {
        try {
            return Files.createTempDirectory("getjobs-boss-thresholds-");
        } catch (Exception exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
