package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.ProposalStatus;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;

import java.nio.file.Path;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HrAssistantStoreTest {
    @TempDir
    Path tempDir;

    private JdbcTemplate jdbcTemplate;
    private HrAssistantStore store;

    @BeforeEach
    void setUp() {
        DriverManagerDataSource dataSource = new DriverManagerDataSource(
                "jdbc:sqlite:" + tempDir.resolve("hr-assistant.db").toAbsolutePath());
        Flyway.configure().dataSource(dataSource).locations("classpath:db/migration").load().migrate();
        jdbcTemplate = new JdbcTemplate(dataSource);
        jdbcTemplate.update("INSERT INTO profile(id, name, is_active) VALUES (1, 'profile', 1)");
        store = new HrAssistantStore(jdbcTemplate,
                new HrAssistantCryptoService(tempDir.resolve("secrets/hr-chat.key")), new ObjectMapper());
    }

    @Test
    void encryptsConversationDraftConfirmationAndSendEvidenceAtRest() {
        CommunicationProfile communication = new CommunicationProfile(
                "期望薪资二十五K", "深圳南山", "两周到岗", "周三下午", "QQ", "礼貌", "不透露身份证");
        store.saveSettings(1L, communication, true, "ws://127.0.0.1:3001",
                "napcat-secret-token", QqTargetType.PRIVATE, "123456789", "", 30);
        ChatSession session = new ChatSession("uid-sensitive-100", "security", "胡女士", "秘密公司",
                "产品运营", "HR", "明天下午面试吗", "11:02");
        long conversationId = store.upsertConversation(1L, session);
        ChatMessage inbound = new ChatMessage("对方", "文本", "明天下午面试吗", "2026-09-04 11:02");

        assertThat(store.saveMessage(conversationId, inbound, 30)).isTrue();
        assertThat(store.saveMessage(conversationId, inbound, 30)).isFalse();
        String fingerprint = store.sourceFingerprint(conversationId, inbound);
        store.updateLastInbound(conversationId, fingerprint);
        long proposalId = store.createProposal(1L, conversationId, fingerprint,
                new AiDraft(Classification.INTERVIEW_INVITE, "周三下午三点可以", "面试邀请",
                        List.of("INTERVIEW_TIME"), List.of(), 0.95));
        assertThat(store.hasProposalForSource(conversationId, fingerprint)).isTrue();

        var proposal = store.getProposalView(1L, proposalId);
        assertThat(proposal.confirmationCode()).matches("\\d{4}");
        assertThat(proposal.hrName()).isEqualTo("胡女士");
        assertThat(proposal.sourceMessage()).isEqualTo("明天下午面试吗");
        assertThat(store.requireProposalByCode(1L, proposal.confirmationCode()).uid()).isEqualTo("uid-sensitive-100");

        store.markFinal(proposalId, ProposalStatus.SEND_UNKNOWN, "发送超时结果未知");
        String raw = String.join("|",
                scalar("SELECT communication_profile_cipher || napcat_token_cipher || qq_target_cipher || qq_operator_cipher FROM hr_assistant_settings"),
                scalar("SELECT external_uid_cipher || hr_name_cipher || company_name_cipher || job_name_cipher FROM hr_conversation"),
                scalar("SELECT fingerprint || body_cipher FROM hr_message"),
                scalar("SELECT confirmation_code_hash || confirmation_code_cipher || draft_cipher || summary_cipher FROM hr_reply_proposal"),
                scalar("SELECT evidence_cipher FROM hr_reply_attempt"));
        assertThat(raw)
                .doesNotContain("期望薪资二十五K", "深圳南山", "napcat-secret-token", "123456789")
                .doesNotContain("uid-sensitive-100", "胡女士", "秘密公司", "产品运营")
                .doesNotContain("明天下午面试吗", "周三下午三点可以", "面试邀请", "发送超时结果未知")
                .doesNotContain(proposal.confirmationCode());

        jdbcTemplate.update("UPDATE hr_message SET expires_at=datetime('now', '-1 second')");
        jdbcTemplate.update("UPDATE hr_reply_proposal SET created_at=datetime('now', '-31 days') WHERE id=?", proposalId);
        jdbcTemplate.update("UPDATE hr_conversation SET last_observed_at=datetime('now', '-31 days') WHERE id=?", conversationId);
        store.purgeExpired();
        assertThat(jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM hr_conversation
                 WHERE external_uid_cipher IS NOT NULL OR hr_name_cipher IS NOT NULL
                    OR company_name_cipher IS NOT NULL OR job_name_cipher IS NOT NULL OR job_key IS NOT NULL
                """, Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM hr_reply_proposal
                 WHERE confirmation_code_cipher IS NOT NULL OR draft_cipher IS NOT NULL OR summary_cipher IS NOT NULL
                    OR risk_tags_cipher IS NOT NULL OR missing_facts_cipher IS NOT NULL
                """, Integer.class)).isZero();
        assertThat(jdbcTemplate.queryForObject(
                "SELECT COUNT(*) FROM hr_reply_attempt WHERE evidence_cipher IS NOT NULL", Integer.class)).isZero();
        assertThat(count("hr_conversation")).isEqualTo(1);
        assertThat(count("hr_reply_proposal")).isEqualTo(1);
        assertThat(count("hr_reply_attempt")).isEqualTo(1);
    }

    @Test
    void thirtyDayCleanupRemovesBodiesButKeepsAnonymousProposalStatistics() {
        ChatSession session = new ChatSession("uid-retention", "security", "HR", "公司", "岗位", "HR", "你好", "10:00");
        long conversationId = store.upsertConversation(1L, session);
        ChatMessage message = new ChatMessage("对方", "文本", "你好", "2026-09-04 10:00");
        store.saveMessage(conversationId, message, 30);
        String fingerprint = store.sourceFingerprint(conversationId, message);
        store.updateLastInbound(conversationId, fingerprint);
        long proposalId = store.createProposal(1L, conversationId, fingerprint,
                new AiDraft(Classification.REPLY, "您好", "普通问候", List.of(), List.of(), 0.9));
        String code = store.getProposalView(1L, proposalId).confirmationCode();
        jdbcTemplate.update("UPDATE hr_message SET expires_at=datetime('now', '-1 second')");
        jdbcTemplate.update("UPDATE hr_reply_proposal SET expires_at=datetime('now', '-1 second') WHERE id=?", proposalId);

        assertThat(store.purgeExpired()).isEqualTo(1);
        assertThatThrownBy(() -> store.requireProposalByCode(1L, code))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("失效");
        assertThat(count("hr_message")).isZero();
        assertThat(count("hr_conversation")).isEqualTo(1);
        assertThat(count("hr_reply_proposal")).isEqualTo(1);
        assertThat(store.listProposals(1L, true)).singleElement()
                .satisfies(item -> assertThat(item.sourceMessage()).isEmpty());
    }

    @Test
    void newInboundMessageExpiresThePreviousConfirmationImmediately() {
        ChatSession session = new ChatSession("uid-stale", "security", "HR", "公司", "岗位", "HR", "第一条", "10:00");
        long conversationId = store.upsertConversation(1L, session);
        ChatMessage first = new ChatMessage("对方", "文本", "第一条", "10:00");
        store.saveMessage(conversationId, first, 30);
        String firstFingerprint = store.sourceFingerprint(conversationId, first);
        store.updateLastInbound(conversationId, firstFingerprint);
        long firstProposal = store.createProposal(1L, conversationId, firstFingerprint,
                new AiDraft(Classification.REPLY, "第一条回复", "摘要", List.of(), List.of(), 0.9));

        ChatMessage second = new ChatMessage("对方", "文本", "第二条", "10:01");
        store.saveMessage(conversationId, second, 30);
        store.updateLastInbound(conversationId, store.sourceFingerprint(conversationId, second));

        assertThat(store.getProposalView(1L, firstProposal).status()).isEqualTo("EXPIRED");
    }

    @Test
    void storesGroupTargetAndOptionalOperatorEncrypted() {
        var view = store.saveSettings(1L, CommunicationProfile.empty(), true, "ws://127.0.0.1:3001",
                "group-token-secret", QqTargetType.GROUP, "987654321", "123456789", 30);

        assertThat(view.qqTargetType()).isEqualTo(QqTargetType.GROUP);
        assertThat(view.qqTargetMasked()).isEqualTo("98***21");
        assertThat(view.qqOperatorMasked()).isEqualTo("12***89");
        assertThat(view.qqOperatorConfigured()).isTrue();
        assertThat(store.loadSettingsSecret(1L))
                .satisfies(secret -> {
                    assertThat(secret.qqTargetType()).isEqualTo(QqTargetType.GROUP);
                    assertThat(secret.qqTarget()).isEqualTo("987654321");
                    assertThat(secret.qqOperator()).isEqualTo("123456789");
                });
        assertThat(scalar("SELECT qq_target_cipher || qq_operator_cipher || napcat_token_cipher FROM hr_assistant_settings"))
                .doesNotContain("987654321", "123456789", "group-token-secret");

        store.saveSettings(1L, CommunicationProfile.empty(), true, "ws://127.0.0.1:3001",
                "", QqTargetType.GROUP, "", "", 30);
        assertThat(store.loadSettingsSecret(1L).qqOperator()).isEmpty();
    }

    @Test
    void groupNotificationCanBeEnabledWithoutOperatorButRejectsInvalidOperator() {
        var view = store.saveSettings(1L, CommunicationProfile.empty(), true, "ws://127.0.0.1:3001",
                "group-token-secret", QqTargetType.GROUP, "987654321", "", 30);

        assertThat(view.qqOperatorConfigured()).isFalse();
        assertThat(store.loadSettingsSecret(1L).qqOperator()).isEmpty();
        assertThatThrownBy(() -> store.saveSettings(1L, CommunicationProfile.empty(), true,
                "ws://127.0.0.1:3001", "", QqTargetType.GROUP, "", "not-a-qq", 30))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("操作人 QQ");
    }

    @Test
    void captureAndSendCommandQueuesAreIdempotentEncryptedAndNeverRetryUnknown() {
        assertThat(store.beginCapture(1L, "watch-1", "scan-1", "capture-1")).isTrue();
        store.completeCapture("watch-1", "capture-1");
        assertThat(store.beginCapture(1L, "watch-1", "scan-2", "capture-1")).isFalse();

        ChatSession session = new ChatSession("uid-command", "security", "HR", "公司", "岗位", "HR", "面试吗", "11:02");
        long conversationId = store.upsertConversation(1L, session);
        ChatMessage inbound = new ChatMessage("对方", "文本", "面试吗", "11:02");
        store.saveMessage(conversationId, inbound, 30);
        String fingerprint = store.sourceFingerprint(conversationId, inbound);
        store.updateLastInbound(conversationId, fingerprint);
        long proposalId = store.createProposal(1L, conversationId, fingerprint,
                new AiDraft(Classification.INTERVIEW_INVITE, "可以，请问具体时间？", "面试", List.of(), List.of(), 0.9));

        String commandId = store.queueSendCommand(1L, proposalId, 1, "");
        var claimed = store.claimSendCommand(1L, "watch-1");
        assertThat(claimed.commandId()).isEqualTo(commandId);
        assertThat(claimed.uid()).isEqualTo("uid-command");
        assertThat(scalar("SELECT lease_token_hash FROM hr_send_command WHERE command_id='" + commandId + "'"))
                .doesNotContain(claimed.leaseToken());
        assertThatThrownBy(() -> store.completeSendCommand(1L, "watch-1", commandId, claimed.leaseToken(),
                "SUCCESS", "非法结果", null))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("结果类型");

        var unknown = store.completeSendCommand(1L, "watch-1", commandId, claimed.leaseToken(),
                "RESULT_UNKNOWN", "页面未确认发出", null);
        assertThat(unknown.status()).isEqualTo("SEND_UNKNOWN");
        assertThat(scalar("SELECT evidence_cipher FROM hr_send_command WHERE command_id='" + commandId + "'"))
                .doesNotContain("页面未确认发出");
        assertThat(store.claimSendCommand(1L, "watch-1")).isNull();
    }

    @Test
    void newInboundMessageInvalidatesAnUnclaimedSendCommand() {
        ChatSession session = new ChatSession("uid-stale-command", "security", "HR", "公司", "岗位", "HR", "第一条", "11:02");
        long conversationId = store.upsertConversation(1L, session);
        ChatMessage first = new ChatMessage("对方", "文本", "第一条", "11:02");
        store.saveMessage(conversationId, first, 30);
        String firstFingerprint = store.sourceFingerprint(conversationId, first);
        store.updateLastInbound(conversationId, firstFingerprint);
        long proposalId = store.createProposal(1L, conversationId, firstFingerprint,
                new AiDraft(Classification.REPLY, "第一条回复", "摘要", List.of(), List.of(), 0.9));
        String commandId = store.queueSendCommand(1L, proposalId, 1, "");

        ChatMessage second = new ChatMessage("对方", "文本", "第二条", "11:03");
        store.saveMessage(conversationId, second, 30);
        store.updateLastInbound(conversationId, store.sourceFingerprint(conversationId, second));

        assertThat(store.getProposalView(1L, proposalId).status()).isEqualTo("EXPIRED");
        assertThat(scalar("SELECT status FROM hr_send_command WHERE command_id='" + commandId + "'"))
                .isEqualTo("STALE");
        assertThat(store.claimSendCommand(1L, "watch-1")).isNull();
    }

    private String scalar(String sql) {
        return jdbcTemplate.queryForObject(sql, String.class);
    }

    private int count(String table) {
        return jdbcTemplate.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
    }
}
