package com.getjobs.application.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.ProposalStatus;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
import com.getjobs.application.hr.HrAssistantTypes.SendCommandView;
import com.getjobs.application.hr.HrAssistantTypes.SettingsView;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.support.GeneratedKeyHolder;
import org.springframework.jdbc.support.KeyHolder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.security.SecureRandom;
import java.sql.PreparedStatement;
import java.sql.Statement;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class HrAssistantStore {
    private static final TypeReference<List<String>> STRING_LIST = new TypeReference<>() { };
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final DateTimeFormatter SQLITE_TIMESTAMP = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private final JdbcTemplate jdbcTemplate;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper objectMapper;

    @Transactional(readOnly = true)
    public SettingsSecret loadSettingsSecret(Long profileId) {
        List<SettingsSecret> rows = jdbcTemplate.query("""
                SELECT communication_profile_cipher, napcat_ws_url, napcat_token_cipher,
                       qq_target_cipher, qq_target_type, qq_operator_cipher, qq_enabled, retention_days
                  FROM hr_assistant_settings WHERE profile_id=?
                """, (rs, rowNum) -> {
            String aad = settingsAad(profileId);
            CommunicationProfile profile = parseProfile(crypto.decrypt(rs.getString("communication_profile_cipher"), aad + ":profile"));
            String token = crypto.decrypt(rs.getString("napcat_token_cipher"), aad + ":token");
            String qqTarget = crypto.decrypt(rs.getString("qq_target_cipher"), aad + ":qq");
            String qqOperator = crypto.decrypt(rs.getString("qq_operator_cipher"), aad + ":operator");
            return new SettingsSecret(profileId, profile, rs.getInt("qq_enabled") == 1,
                    emptyToDefault(rs.getString("napcat_ws_url"), "ws://127.0.0.1:3001"), token,
                    readQqTargetType(rs.getString("qq_target_type")), qqTarget, qqOperator,
                    clampRetention(rs.getInt("retention_days")));
        }, profileId);
        return rows.isEmpty()
                ? new SettingsSecret(profileId, CommunicationProfile.empty(), false, "ws://127.0.0.1:3001", "",
                        QqTargetType.PRIVATE, "", "", 30)
                : rows.get(0);
    }

    public SettingsView loadSettings(Long profileId) {
        SettingsSecret secret = loadSettingsSecret(profileId);
        return new SettingsView(profileId, secret.communicationProfile(), secret.qqEnabled(), secret.napcatWsUrl(),
                secret.qqTargetType(), maskQq(secret.qqTarget()), maskQq(secret.qqOperator()),
                !secret.qqOperator().isBlank(), !secret.napcatToken().isBlank(), secret.retentionDays(), true);
    }

    @Transactional
    public SettingsView saveSettings(Long profileId,
                                     CommunicationProfile communicationProfile,
                                     boolean qqEnabled,
                                     String napcatWsUrl,
                                     String napcatToken,
                                     QqTargetType qqTargetType,
                                     String qqTarget,
                                     String qqOperator,
                                     int retentionDays) {
        SettingsSecret current = loadSettingsSecret(profileId);
        CommunicationProfile normalizedProfile = communicationProfile == null ? CommunicationProfile.empty() : communicationProfile;
        String normalizedUrl = validateNapcatUrl(emptyToDefault(napcatWsUrl, current.napcatWsUrl()));
        String normalizedToken = napcatToken == null || napcatToken.isBlank() ? current.napcatToken() : napcatToken.trim();
        QqTargetType normalizedTargetType = qqTargetType == null ? current.qqTargetType() : qqTargetType;
        boolean targetTypeChanged = normalizedTargetType != current.qqTargetType();
        String normalizedTarget = qqTarget == null || qqTarget.isBlank()
                ? targetTypeChanged ? "" : current.qqTarget()
                : qqTarget.trim();
        String normalizedOperator = qqOperator == null ? current.qqOperator() : qqOperator.trim();
        if (qqEnabled && (normalizedToken.isBlank() || !normalizedTarget.matches("\\d{5,15}"))) {
            throw new IllegalArgumentException("启用 QQ 通知前必须填写 NapCat Token 和 5-15 位目标 QQ/群号");
        }
        if (!normalizedOperator.isBlank() && !normalizedOperator.matches("\\d{5,15}")) {
            throw new IllegalArgumentException("群内操作人 QQ 必须是 5-15 位数字");
        }
        int safeRetention = clampRetention(retentionDays);
        String aad = settingsAad(profileId);
        String profileJson = writeJson(normalizedProfile);
        jdbcTemplate.update("""
                INSERT INTO hr_assistant_settings(
                    profile_id, communication_profile_cipher, napcat_ws_url, napcat_token_cipher,
                    qq_target_cipher, qq_target_type, qq_operator_cipher, qq_enabled, retention_days, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(profile_id) DO UPDATE SET
                    communication_profile_cipher=excluded.communication_profile_cipher,
                    napcat_ws_url=excluded.napcat_ws_url,
                    napcat_token_cipher=excluded.napcat_token_cipher,
                    qq_target_cipher=excluded.qq_target_cipher,
                    qq_target_type=excluded.qq_target_type,
                    qq_operator_cipher=excluded.qq_operator_cipher,
                    qq_enabled=excluded.qq_enabled,
                    retention_days=excluded.retention_days,
                    updated_at=CURRENT_TIMESTAMP
                """, profileId, crypto.encrypt(profileJson, aad + ":profile"), normalizedUrl,
                crypto.encrypt(normalizedToken, aad + ":token"), crypto.encrypt(normalizedTarget, aad + ":qq"),
                normalizedTargetType.name(), crypto.encrypt(normalizedOperator, aad + ":operator"),
                qqEnabled ? 1 : 0, safeRetention);
        return loadSettings(profileId);
    }

    @Transactional
    public long upsertConversation(Long profileId, ChatSession session) {
        String uidHash = crypto.blindIndex(session.uid(), "conversation:" + profileId);
        String aad = conversationAad(profileId, uidHash);
        jdbcTemplate.update("""
                INSERT INTO hr_conversation(
                    profile_id, platform, external_uid_hash, external_uid_cipher, hr_name_cipher,
                    company_name_cipher, job_name_cipher, job_key, last_observed_at, created_at, updated_at)
                VALUES (?, 'boss', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                ON CONFLICT(profile_id, platform, external_uid_hash) DO UPDATE SET
                    external_uid_cipher=excluded.external_uid_cipher,
                    hr_name_cipher=excluded.hr_name_cipher,
                    company_name_cipher=excluded.company_name_cipher,
                    job_name_cipher=excluded.job_name_cipher,
                    job_key=COALESCE(excluded.job_key, hr_conversation.job_key),
                    last_observed_at=CURRENT_TIMESTAMP,
                    updated_at=CURRENT_TIMESTAMP
                """, profileId, uidHash, crypto.encrypt(session.uid(), aad),
                crypto.encrypt(safe(session.hrName()), aad + ":hr"),
                crypto.encrypt(safe(session.companyName()), aad + ":company"),
                crypto.encrypt(safe(session.jobName()), aad + ":job"), findJobKey(profileId, session));
        return jdbcTemplate.queryForObject("""
                SELECT id FROM hr_conversation
                 WHERE profile_id=? AND platform='boss' AND external_uid_hash=?
                """, Long.class, profileId, uidHash);
    }

    @Transactional
    public boolean saveMessage(long conversationId, ChatMessage message, int retentionDays) {
        String fingerprint = fingerprint(conversationId, message);
        int changed = jdbcTemplate.update("""
                INSERT OR IGNORE INTO hr_message(
                    conversation_id, fingerprint, direction, message_type, body_cipher,
                    message_time, observed_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, datetime('now', ?))
                """, conversationId, fingerprint, message.inbound() ? "INBOUND" : "OUTBOUND", safe(message.type()),
                crypto.encrypt(safe(message.text()), messageAad(conversationId, fingerprint)), safe(message.time()),
                "+" + clampRetention(retentionDays) + " days");
        return changed == 1;
    }

    @Transactional
    public boolean beginCapture(Long profileId, String watchSessionId, String scanId, String captureId) {
        List<CaptureRecord> existing = jdbcTemplate.query("""
                SELECT status, updated_at,
                       updated_at>datetime('now', '-5 minutes') AS is_recent
                  FROM hr_scan_capture
                 WHERE watch_session_id=? AND capture_id=?
                """, (rs, rowNum) -> new CaptureRecord(rs.getString("status"), readDateTime(rs.getString("updated_at")),
                        rs.getInt("is_recent") == 1),
                safe(watchSessionId), safe(captureId));
        if (existing.isEmpty()) {
            jdbcTemplate.update("""
                    INSERT INTO hr_scan_capture(watch_session_id, capture_id, profile_id, scan_id, status, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'PROCESSING', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """, safe(watchSessionId), safe(captureId), profileId, safe(scanId));
            return true;
        }
        CaptureRecord record = existing.get(0);
        if ("COMPLETE".equals(record.status())) return false;
        if ("PROCESSING".equals(record.status()) && record.recent()) {
            throw new IllegalStateException("同一 HR 消息快照仍在处理中，已保留扩展 Outbox");
        }
        jdbcTemplate.update("""
                UPDATE hr_scan_capture
                   SET profile_id=?, scan_id=?, status='PROCESSING', error_code=NULL, updated_at=CURRENT_TIMESTAMP
                 WHERE watch_session_id=? AND capture_id=?
                """, profileId, safe(scanId), safe(watchSessionId), safe(captureId));
        return true;
    }

    @Transactional
    public void completeCapture(String watchSessionId, String captureId) {
        jdbcTemplate.update("""
                UPDATE hr_scan_capture SET status='COMPLETE', error_code=NULL, updated_at=CURRENT_TIMESTAMP
                 WHERE watch_session_id=? AND capture_id=?
                """, safe(watchSessionId), safe(captureId));
    }

    @Transactional
    public void failCapture(String watchSessionId, String captureId, String errorCode) {
        jdbcTemplate.update("""
                UPDATE hr_scan_capture SET status='FAILED', error_code=?, updated_at=CURRENT_TIMESTAMP
                 WHERE watch_session_id=? AND capture_id=?
                """, safe(errorCode), safe(watchSessionId), safe(captureId));
    }

    @Transactional
    public void updateLastInbound(long conversationId, String fingerprint) {
        jdbcTemplate.update("""
                UPDATE hr_conversation SET last_inbound_fingerprint=?, last_observed_at=CURRENT_TIMESTAMP,
                       updated_at=CURRENT_TIMESTAMP WHERE id=?
                """, fingerprint, conversationId);
        jdbcTemplate.update("""
                UPDATE hr_reply_proposal SET status='EXPIRED', version=version+1, updated_at=CURRENT_TIMESTAMP
                 WHERE conversation_id=? AND source_fingerprint<>?
                   AND status IN ('OBSERVED','GENERATING','REVIEW_REQUIRED','APPROVED')
                """, conversationId, fingerprint);
        jdbcTemplate.update("""
                UPDATE hr_send_command SET status='STALE', outcome='STALE', updated_at=CURRENT_TIMESTAMP
                 WHERE proposal_id IN (
                       SELECT id FROM hr_reply_proposal WHERE conversation_id=? AND source_fingerprint<>?
                 ) AND status='PENDING'
                """, conversationId, fingerprint);
    }

    @Transactional(readOnly = true)
    public boolean hasProposalForSource(long conversationId, String sourceFingerprint) {
        Long count = jdbcTemplate.queryForObject("""
                SELECT COUNT(*) FROM hr_reply_proposal
                 WHERE conversation_id=? AND source_fingerprint=?
                """, Long.class, conversationId, sourceFingerprint);
        return count != null && count > 0;
    }

    @Transactional
    public long createProposal(Long profileId,
                               long conversationId,
                               String sourceFingerprint,
                               com.getjobs.application.hr.HrAssistantTypes.AiDraft draft) {
        String code = nextConfirmationCode(profileId);
        String codeHash = confirmationCodeHash(profileId, code);
        LocalDateTime expiresAt = LocalDateTime.now().plusMinutes(15);
        KeyHolder keys = new GeneratedKeyHolder();
        jdbcTemplate.update(connection -> {
            PreparedStatement statement = connection.prepareStatement("""
                    INSERT INTO hr_reply_proposal(
                        profile_id, conversation_id, confirmation_code_hash, confirmation_code_cipher, source_fingerprint, status,
                        classification, draft_cipher, summary_cipher, risk_tags_cipher,
                        missing_facts_cipher, confidence, version, expires_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, 'REVIEW_REQUIRED', ?, ?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                    """, Statement.RETURN_GENERATED_KEYS);
            statement.setLong(1, profileId);
            statement.setLong(2, conversationId);
            statement.setString(3, codeHash);
            String aad = proposalAad(profileId, sourceFingerprint);
            statement.setString(4, crypto.encrypt(code, aad + ":code"));
            statement.setString(5, sourceFingerprint);
            statement.setString(6, draft.classification().name());
            statement.setString(7, crypto.encrypt(safe(draft.replyText()), aad + ":draft"));
            statement.setString(8, crypto.encrypt(safe(draft.summary()), aad + ":summary"));
            statement.setString(9, crypto.encrypt(writeJson(draft.riskTags()), aad + ":risk"));
            statement.setString(10, crypto.encrypt(writeJson(draft.missingFacts()), aad + ":missing"));
            statement.setDouble(11, Math.max(0, Math.min(1, draft.confidence())));
            statement.setString(12, expiresAt.format(SQLITE_TIMESTAMP));
            return statement;
        }, keys);
        Number key = keys.getKey();
        if (key == null) throw new IllegalStateException("创建 HR 回复草稿后未取得任务 ID");
        return key.longValue();
    }

    @Transactional(readOnly = true)
    public List<ProposalView> listProposals(Long profileId, boolean includeClosed) {
        String filter = includeClosed ? "" : " AND p.status IN ('REVIEW_REQUIRED','APPROVED','SENDING','SEND_UNKNOWN','BLOCKED')";
        return jdbcTemplate.query("""
                SELECT p.*, c.external_uid_hash, c.hr_name_cipher, c.company_name_cipher, c.job_name_cipher,
                       m.body_cipher AS source_body_cipher
                  FROM hr_reply_proposal p
                  JOIN hr_conversation c ON c.id=p.conversation_id
             LEFT JOIN hr_message m ON m.conversation_id=p.conversation_id AND m.fingerprint=p.source_fingerprint
                 WHERE p.profile_id=?
                """ + filter + " ORDER BY p.updated_at DESC LIMIT 200", (rs, rowNum) -> {
            String sourceFingerprint = rs.getString("source_fingerprint");
            String aad = proposalAad(profileId, sourceFingerprint);
            String code = crypto.decrypt(rs.getString("confirmation_code_cipher"), aad + ":code");
            long conversationId = rs.getLong("conversation_id");
            String conversationAad = conversationAad(profileId, rs.getString("external_uid_hash"));
            String classification = rs.getString("classification");
            List<String> risk = readStringList(crypto.decrypt(rs.getString("risk_tags_cipher"), aad + ":risk"));
            List<String> missing = readStringList(crypto.decrypt(rs.getString("missing_facts_cipher"), aad + ":missing"));
            return new ProposalView(rs.getLong("id"), profileId, conversationId, code, rs.getString("status"),
                    classification,
                    crypto.decrypt(rs.getString("hr_name_cipher"), conversationAad + ":hr"),
                    crypto.decrypt(rs.getString("company_name_cipher"), conversationAad + ":company"),
                    crypto.decrypt(rs.getString("job_name_cipher"), conversationAad + ":job"),
                    crypto.decrypt(rs.getString("source_body_cipher"), messageAad(conversationId, sourceFingerprint)),
                    crypto.decrypt(rs.getString("draft_cipher"), aad + ":draft"),
                    crypto.decrypt(rs.getString("summary_cipher"), aad + ":summary"), risk, missing,
                    rs.getDouble("confidence"), rs.getInt("version"), readDateTime(rs.getString("expires_at")),
                    readDateTime(rs.getString("updated_at")), isHighValue(classification, risk, missing));
        }, profileId);
    }

    @Transactional(readOnly = true)
    public ProposalView getProposalView(Long profileId, long proposalId) {
        return listProposals(profileId, true).stream()
                .filter(item -> item.id() == proposalId)
                .findFirst()
                .orElseThrow(() -> new IllegalArgumentException("未找到 HR 回复任务"));
    }

    @Transactional(readOnly = true)
    public ProposalRecord requireProposal(Long profileId, long proposalId) {
        List<ProposalRecord> rows = jdbcTemplate.query("""
                SELECT p.*, c.external_uid_hash, c.external_uid_cipher, c.hr_name_cipher, c.company_name_cipher,
                       c.job_name_cipher, c.last_inbound_fingerprint
                  FROM hr_reply_proposal p JOIN hr_conversation c ON c.id=p.conversation_id
                 WHERE p.id=? AND p.profile_id=?
                """, (rs, rowNum) -> mapProposalRecord(rs, profileId), proposalId, profileId);
        if (rows.isEmpty()) throw new IllegalArgumentException("未找到 HR 回复任务");
        return rows.get(0);
    }

    @Transactional(readOnly = true)
    public ProposalRecord requireProposalByCode(Long profileId, String code) {
        List<ProposalRecord> rows = jdbcTemplate.query("""
                SELECT p.*, c.external_uid_hash, c.external_uid_cipher, c.hr_name_cipher, c.company_name_cipher,
                       c.job_name_cipher, c.last_inbound_fingerprint
                  FROM hr_reply_proposal p JOIN hr_conversation c ON c.id=p.conversation_id
                 WHERE p.profile_id=? AND p.confirmation_code_hash=?
                   AND p.expires_at>datetime('now', 'localtime')
                 ORDER BY p.created_at DESC LIMIT 1
                """, (rs, rowNum) -> mapProposalRecord(rs, profileId), profileId, confirmationCodeHash(profileId, code));
        if (rows.isEmpty()) throw new IllegalArgumentException("确认码不存在或已失效");
        return rows.get(0);
    }

    @Transactional
    public ProposalView revise(Long profileId, long proposalId, int expectedVersion, String newDraft) {
        if (newDraft == null || newDraft.isBlank()) throw new IllegalArgumentException("回复内容不能为空");
        ProposalRecord record = requireProposal(profileId, proposalId);
        assertReviewable(record);
        String aad = proposalAad(profileId, record.sourceFingerprint());
        int changed = jdbcTemplate.update("""
                UPDATE hr_reply_proposal SET draft_cipher=?, version=version+1, status='REVIEW_REQUIRED',
                       updated_at=CURRENT_TIMESTAMP
                 WHERE id=? AND profile_id=? AND version=? AND status='REVIEW_REQUIRED'
                """, crypto.encrypt(newDraft.trim(), aad + ":draft"), proposalId, profileId, expectedVersion);
        if (changed != 1) throw new StaleProposalException("草稿已变化，请刷新后重新确认");
        return getProposalView(profileId, proposalId);
    }

    @Transactional
    public void transition(long proposalId, ProposalStatus from, ProposalStatus to) {
        int changed = jdbcTemplate.update("""
                UPDATE hr_reply_proposal SET status=?, version=version+1, updated_at=CURRENT_TIMESTAMP
                 WHERE id=? AND status=?
                """, to.name(), proposalId, from.name());
        if (changed != 1) throw new StaleProposalException("回复任务状态已变化，请刷新后重试");
    }

    @Transactional
    public void markFinal(long proposalId, ProposalStatus status, String evidence) {
        ProposalRecord record = requireProposalByIdAnyProfile(proposalId);
        String requestKey = "boss-hr:" + proposalId + ":" + record.version();
        jdbcTemplate.update("""
                INSERT INTO hr_reply_attempt(proposal_id, request_key, status, evidence_cipher, approved_at,
                    attempted_at, confirmed_at, updated_at)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
                    CASE WHEN ?='SENT_CONFIRMED' THEN CURRENT_TIMESTAMP ELSE NULL END, CURRENT_TIMESTAMP)
                ON CONFLICT(proposal_id) DO UPDATE SET status=excluded.status,
                    evidence_cipher=excluded.evidence_cipher, attempted_at=excluded.attempted_at,
                    confirmed_at=excluded.confirmed_at, updated_at=CURRENT_TIMESTAMP
                """, proposalId, requestKey, status.name(),
                crypto.encrypt(safe(evidence), "attempt:" + proposalId), status.name());
        jdbcTemplate.update("UPDATE hr_reply_proposal SET status=?, version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                status.name(), proposalId);
    }

    @Transactional
    public String queueSendCommand(Long profileId, long proposalId, int expectedVersion, String watchSessionId) {
        ProposalRecord record = requireProposal(profileId, proposalId);
        assertReviewable(record);
        if (record.version() != expectedVersion) throw new StaleProposalException("草稿版本已变化，请刷新后重新确认");
        if (!record.sourceFingerprint().equals(record.lastInboundFingerprint())) {
            throw new StaleProposalException("HR 已发送新消息，旧确认已作废");
        }
        String commandId = UUID.randomUUID().toString();
        int changed = jdbcTemplate.update("""
                UPDATE hr_reply_proposal SET status='APPROVED', version=version+1, updated_at=CURRENT_TIMESTAMP
                 WHERE id=? AND profile_id=? AND version=? AND status='REVIEW_REQUIRED'
                """, proposalId, profileId, expectedVersion);
        if (changed != 1) throw new StaleProposalException("回复任务状态已变化，请刷新后重试");
        jdbcTemplate.update("""
                INSERT INTO hr_send_command(command_id, proposal_id, profile_id, watch_session_id, status, expires_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, 'PENDING', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, commandId, proposalId, profileId, safe(watchSessionId), record.expiresAt().format(SQLITE_TIMESTAMP));
        return commandId;
    }

    @Transactional
    public SendCommandView claimSendCommand(Long profileId, String watchSessionId) {
        expireUnconfirmedLeases();
        List<String> commands = jdbcTemplate.query("""
                SELECT command_id FROM hr_send_command c
                JOIN hr_reply_proposal p ON p.id=c.proposal_id
                JOIN hr_conversation v ON v.id=p.conversation_id
                 WHERE c.profile_id=? AND (c.watch_session_id='' OR c.watch_session_id=?) AND c.status='PENDING'
                   AND c.expires_at>datetime('now', 'localtime') AND p.status='APPROVED'
                   AND p.source_fingerprint=v.last_inbound_fingerprint
                 ORDER BY c.created_at LIMIT 1
                """, (rs, rowNum) -> rs.getString(1), profileId, safe(watchSessionId));
        if (commands.isEmpty()) return null;
        String commandId = commands.get(0);
        String leaseToken = UUID.randomUUID().toString();
        String leaseHash = crypto.blindIndex(leaseToken, "send-lease:" + commandId);
        int leased = jdbcTemplate.update("""
                UPDATE hr_send_command
                   SET watch_session_id=?, status='LEASED', lease_token_hash=?,
                       lease_expires_at=datetime('now', '+60 seconds'), updated_at=CURRENT_TIMESTAMP
                 WHERE command_id=? AND status='PENDING'
                """, safe(watchSessionId), leaseHash, commandId);
        if (leased != 1) return null;
        Long proposalId = jdbcTemplate.queryForObject(
                "SELECT proposal_id FROM hr_send_command WHERE command_id=?", Long.class, commandId);
        if (proposalId == null) throw new IllegalStateException("待发送命令缺少回复任务");
        transition(proposalId, ProposalStatus.APPROVED, ProposalStatus.SENDING);
        ProposalRecord record = requireProposal(profileId, proposalId);
        ChatMessage expectedInbound = recentMessages(record.conversationId(), 20).stream()
                .filter(ChatMessage::inbound)
                .filter(message -> sourceFingerprint(record.conversationId(), message).equals(record.sourceFingerprint()))
                .reduce((first, second) -> second)
                .orElseThrow(() -> new StaleProposalException("发送命令的来源消息已不存在"));
        return new SendCommandView(commandId, leaseToken, proposalId, record.uid(), record.hrName(),
                record.companyName(), record.jobName(), record.sourceFingerprint(), expectedInbound,
                record.draft(), record.expiresAt());
    }

    @Transactional
    public ProposalView completeSendCommand(Long profileId,
                                            String watchSessionId,
                                            String commandId,
                                            String leaseToken,
                                            String outcome,
                                            String evidence,
                                            ChatMessage observedLatestInbound) {
        List<SendCommandRecord> commands = jdbcTemplate.query("""
                SELECT proposal_id, lease_token_hash, status, lease_expires_at,
                       lease_expires_at<=CURRENT_TIMESTAMP AS lease_expired
                  FROM hr_send_command
                 WHERE command_id=? AND profile_id=? AND watch_session_id=?
                """, (rs, rowNum) -> new SendCommandRecord(rs.getLong("proposal_id"), rs.getString("lease_token_hash"),
                        rs.getString("status"), readDateTime(rs.getString("lease_expires_at")), rs.getInt("lease_expired") == 1),
                safe(commandId), profileId, safe(watchSessionId));
        if (commands.size() != 1) throw new StaleProposalException("发送命令不存在或不属于当前值守标签");
        SendCommandRecord command = commands.get(0);
        String expectedLeaseHash = crypto.blindIndex(safe(leaseToken), "send-lease:" + safe(commandId));
        if (!"LEASED".equals(command.status()) || !expectedLeaseHash.equals(command.leaseTokenHash())) {
            throw new StaleProposalException("发送命令租约无效，禁止重复提交结果");
        }
        if (command.leaseExpired()) {
            jdbcTemplate.update("""
                    UPDATE hr_send_command SET status='COMPLETE', outcome='RESULT_UNKNOWN',
                           lease_token_hash=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
                     WHERE command_id=? AND status='LEASED'
                    """, safe(commandId));
            markFinal(command.proposalId(), ProposalStatus.SEND_UNKNOWN, "浏览器发送租约已过期，结果未知且禁止自动重试");
            return getProposalView(profileId, command.proposalId());
        }
        ProposalRecord proposal = requireProposal(profileId, command.proposalId());
        String normalizedOutcome = safe(outcome).toUpperCase(Locale.ROOT);
        if (!Set.of("SENT", "STALE", "RESULT_UNKNOWN", "FAILED_SAFE").contains(normalizedOutcome)) {
            throw new IllegalArgumentException("发送结果类型无效");
        }
        if ("SENT".equals(normalizedOutcome)) {
            if (observedLatestInbound == null || !observedLatestInbound.inbound()
                    || !sourceFingerprint(proposal.conversationId(), observedLatestInbound).equals(proposal.sourceFingerprint())) {
                normalizedOutcome = "RESULT_UNKNOWN";
                evidence = "发送后来源消息无法与确认快照一致；" + safe(evidence);
            }
        }
        ProposalStatus finalStatus = switch (normalizedOutcome) {
            case "SENT" -> ProposalStatus.SENT_CONFIRMED;
            case "STALE" -> ProposalStatus.EXPIRED;
            case "FAILED_SAFE" -> ProposalStatus.BLOCKED;
            default -> ProposalStatus.SEND_UNKNOWN;
        };
        jdbcTemplate.update("""
                UPDATE hr_send_command SET status='COMPLETE', outcome=?, evidence_cipher=?,
                       lease_token_hash=NULL, lease_expires_at=NULL, updated_at=CURRENT_TIMESTAMP
                 WHERE command_id=?
                """, normalizedOutcome, crypto.encrypt(safe(evidence), "send-command:" + safe(commandId)), safe(commandId));
        markFinal(command.proposalId(), finalStatus, safe(evidence));
        return getProposalView(profileId, command.proposalId());
    }

    private void expireUnconfirmedLeases() {
        List<Long> expired = jdbcTemplate.query("""
                SELECT proposal_id FROM hr_send_command
                 WHERE status='LEASED' AND lease_expires_at<CURRENT_TIMESTAMP
                """, (rs, rowNum) -> rs.getLong(1));
        for (Long proposalId : expired) {
            jdbcTemplate.update("""
                    UPDATE hr_send_command SET status='COMPLETE', outcome='RESULT_UNKNOWN',
                           lease_token_hash=NULL, updated_at=CURRENT_TIMESTAMP
                     WHERE proposal_id=? AND status='LEASED'
                    """, proposalId);
            markFinal(proposalId, ProposalStatus.SEND_UNKNOWN, "浏览器发送租约超时，结果未知且禁止自动重试");
        }
    }

    @Transactional
    public void skip(Long profileId, long proposalId) {
        ProposalRecord record = requireProposal(profileId, proposalId);
        assertReviewable(record);
        jdbcTemplate.update("UPDATE hr_reply_proposal SET status='SKIPPED', version=version+1, updated_at=CURRENT_TIMESTAMP WHERE id=?", proposalId);
    }

    @Transactional(readOnly = true)
    public List<ChatMessage> recentMessages(long conversationId, int limit) {
        List<ChatMessage> rows = jdbcTemplate.query("""
                SELECT fingerprint, direction, message_type, body_cipher, message_time
                  FROM hr_message WHERE conversation_id=? ORDER BY id DESC LIMIT ?
                """, (rs, rowNum) -> new ChatMessage(
                "INBOUND".equals(rs.getString("direction")) ? "对方" : "我", rs.getString("message_type"),
                crypto.decrypt(rs.getString("body_cipher"), messageAad(conversationId, rs.getString("fingerprint"))),
                safe(rs.getString("message_time"))), conversationId, Math.max(1, Math.min(limit, 20)));
        Collections.reverse(rows);
        return rows;
    }

    @Transactional(readOnly = true)
    public String sourceFingerprint(long conversationId, ChatMessage message) {
        return fingerprint(conversationId, message);
    }

    @Transactional
    public boolean rememberQqCommand(String messageId, String senderId, String commandType) {
        if (messageId == null || messageId.isBlank()) return false;
        return jdbcTemplate.update("""
                INSERT OR IGNORE INTO hr_qq_command(message_id, sender_hash, command_type, received_at, expires_at)
                VALUES (?, ?, ?, CURRENT_TIMESTAMP, datetime('now', '+30 days'))
                """, messageId, crypto.blindIndex(senderId, "qq-sender"), safe(commandType)) == 1;
    }

    @Transactional
    public int purgeExpired() {
        jdbcTemplate.update("UPDATE hr_reply_proposal SET status='EXPIRED', version=version+1, updated_at=CURRENT_TIMESTAMP " +
                "WHERE expires_at<datetime('now', 'localtime') AND status IN ('OBSERVED','GENERATING','REVIEW_REQUIRED','APPROVED')");
        int messages = jdbcTemplate.update("DELETE FROM hr_message WHERE expires_at<CURRENT_TIMESTAMP");
        jdbcTemplate.update("""
                UPDATE hr_reply_attempt SET evidence_cipher=NULL
                 WHERE proposal_id IN (
                       SELECT id FROM hr_reply_proposal WHERE created_at<datetime('now', '-30 days'))
                """);
        jdbcTemplate.update("""
                UPDATE hr_reply_proposal
                   SET confirmation_code_cipher=NULL, draft_cipher=NULL, summary_cipher=NULL,
                       risk_tags_cipher=NULL, missing_facts_cipher=NULL
                 WHERE created_at<datetime('now', '-30 days')
                """);
        jdbcTemplate.update("""
                UPDATE hr_conversation
                   SET external_uid_cipher=NULL, hr_name_cipher=NULL, company_name_cipher=NULL,
                       job_name_cipher=NULL, job_key=NULL
                 WHERE last_observed_at<datetime('now', '-30 days')
                """);
        jdbcTemplate.update("DELETE FROM hr_qq_command WHERE expires_at<CURRENT_TIMESTAMP");
        jdbcTemplate.update("DELETE FROM hr_scan_capture WHERE updated_at<datetime('now', '-30 days')");
        jdbcTemplate.update("DELETE FROM hr_send_command WHERE updated_at<datetime('now', '-30 days')");
        return messages;
    }

    private ProposalRecord mapProposalRecord(java.sql.ResultSet rs, Long profileId) throws java.sql.SQLException {
        String sourceFingerprint = rs.getString("source_fingerprint");
        String aad = proposalAad(profileId, sourceFingerprint);
        String code = crypto.decrypt(rs.getString("confirmation_code_cipher"), aad + ":code");
        String uidHash = rs.getString("external_uid_hash");
        String uid = crypto.decrypt(rs.getString("external_uid_cipher"), conversationAad(profileId, uidHash));
        String conversationAad = conversationAad(profileId, uidHash);
        return new ProposalRecord(rs.getLong("id"), profileId, rs.getLong("conversation_id"), code,
                sourceFingerprint, ProposalStatus.valueOf(rs.getString("status")),
                rs.getString("classification"), crypto.decrypt(rs.getString("draft_cipher"), aad + ":draft"),
                rs.getInt("version"), readDateTime(rs.getString("expires_at")), uid,
                crypto.decrypt(rs.getString("hr_name_cipher"), conversationAad + ":hr"),
                crypto.decrypt(rs.getString("company_name_cipher"), conversationAad + ":company"),
                crypto.decrypt(rs.getString("job_name_cipher"), conversationAad + ":job"),
                rs.getString("last_inbound_fingerprint"));
    }

    private ProposalRecord requireProposalByIdAnyProfile(long proposalId) {
        Long profileId = jdbcTemplate.queryForObject("SELECT profile_id FROM hr_reply_proposal WHERE id=?", Long.class, proposalId);
        if (profileId == null) throw new IllegalArgumentException("未找到 HR 回复任务");
        return requireProposal(profileId, proposalId);
    }

    private String findJobKey(Long profileId, ChatSession session) {
        List<String> matches = jdbcTemplate.query("""
                SELECT encrypt_id FROM boss_data
                 WHERE profile_id=? AND (encrypt_user_id=? OR (company_name=? AND job_name=?))
                 ORDER BY updated_at DESC LIMIT 2
                """, (rs, rowNum) -> rs.getString(1), profileId, session.uid(), session.companyName(), session.jobName());
        return matches.size() == 1 ? matches.get(0) : null;
    }

    private void assertReviewable(ProposalRecord record) {
        if (record.expiresAt().isBefore(LocalDateTime.now())) throw new StaleProposalException("确认码已过期");
        if (record.status() != ProposalStatus.REVIEW_REQUIRED) throw new StaleProposalException("当前回复任务不可编辑或发送");
    }

    private String nextConfirmationCode(Long profileId) {
        for (int i = 0; i < 20; i++) {
            String code = String.format(Locale.ROOT, "%04d", RANDOM.nextInt(10_000));
            Long count = jdbcTemplate.queryForObject("""
                    SELECT COUNT(*) FROM hr_reply_proposal
                     WHERE profile_id=? AND confirmation_code_hash=? AND expires_at>datetime('now', 'localtime')
                       AND status IN ('REVIEW_REQUIRED','APPROVED','SENDING')
                    """, Long.class, profileId, confirmationCodeHash(profileId, code));
            if (count == null || count == 0) return code;
        }
        throw new IllegalStateException("暂时无法生成唯一确认码，请稍后重试");
    }

    private String fingerprint(long conversationId, ChatMessage message) {
        return crypto.blindIndex(safe(message.from()) + "|" + safe(message.type()) + "|" +
                safe(message.time()) + "|" + safe(message.text()), "message:" + conversationId);
    }

    private boolean isHighValue(String classification, List<String> risk, List<String> missing) {
        return List.of("NEEDS_USER", "INTERVIEW_INVITE", "OFFER", "COMPENSATION", "AVAILABILITY",
                        "CONTACT_REQUEST", "DOCUMENT_REQUEST", "SUSPICIOUS").contains(classification)
                || !risk.isEmpty() || !missing.isEmpty();
    }

    private CommunicationProfile parseProfile(String json) {
        if (json == null || json.isBlank()) return CommunicationProfile.empty();
        try {
            return objectMapper.readValue(json, CommunicationProfile.class);
        } catch (Exception e) {
            throw new IllegalStateException("沟通资料解密后无法解析", e);
        }
    }

    private List<String> readStringList(String json) {
        if (json == null || json.isBlank()) return List.of();
        try {
            return objectMapper.readValue(json, STRING_LIST);
        } catch (Exception e) {
            throw new IllegalStateException("HR 助手列表字段无法解析", e);
        }
    }

    private String writeJson(Object value) {
        try {
            return objectMapper.writeValueAsString(value);
        } catch (Exception e) {
            throw new IllegalStateException("HR 助手数据无法序列化", e);
        }
    }

    private String settingsAad(Long profileId) {
        return "settings:" + profileId;
    }

    private String conversationAad(Long profileId, String uidHash) {
        return "conversation:" + profileId + ":" + uidHash;
    }

    private String messageAad(long conversationId, String fingerprint) {
        return "message:" + conversationId + ":" + fingerprint;
    }

    private String proposalAad(Long profileId, String sourceFingerprint) {
        return "proposal:" + profileId + ":" + sourceFingerprint;
    }

    private String confirmationCodeHash(Long profileId, String code) {
        return crypto.blindIndex(safe(code), "confirmation:" + profileId);
    }

    private String validateNapcatUrl(String value) {
        String normalized = value == null ? "" : value.trim();
        if (!normalized.matches("ws://(127\\.0\\.0\\.1|localhost)(:\\d{1,5})?(/.*)?")) {
            throw new IllegalArgumentException("NapCat WebSocket 只允许连接本机 127.0.0.1 或 localhost");
        }
        return normalized;
    }

    private int clampRetention(int days) {
        return Math.max(1, Math.min(days <= 0 ? 30 : days, 30));
    }

    private String maskQq(String qq) {
        if (qq == null || qq.length() < 5) return "";
        return qq.substring(0, 2) + "***" + qq.substring(qq.length() - 2);
    }

    private String emptyToDefault(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value.trim();
    }

    private QqTargetType readQqTargetType(String value) {
        if (value == null || value.isBlank()) return QqTargetType.PRIVATE;
        try {
            return QqTargetType.valueOf(value.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException ignored) {
            return QqTargetType.PRIVATE;
        }
    }

    private LocalDateTime readDateTime(String value) {
        if (value == null || value.isBlank()) return LocalDateTime.MIN;
        String normalized = value.trim().replace(' ', 'T');
        return LocalDateTime.parse(normalized);
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    public record SettingsSecret(Long profileId,
                                 CommunicationProfile communicationProfile,
                                 boolean qqEnabled,
                                 String napcatWsUrl,
                                 String napcatToken,
                                 QqTargetType qqTargetType,
                                 String qqTarget,
                                 String qqOperator,
                                 int retentionDays) {
    }

    public record ProposalRecord(long id,
                                 Long profileId,
                                 long conversationId,
                                 String confirmationCode,
                                 String sourceFingerprint,
                                 ProposalStatus status,
                                 String classification,
                                 String draft,
                                 int version,
                                 LocalDateTime expiresAt,
                                 String uid,
                                 String hrName,
                                 String companyName,
                                 String jobName,
                                  String lastInboundFingerprint) {
    }

    private record CaptureRecord(String status, LocalDateTime updatedAt, boolean recent) {
    }

    private record SendCommandRecord(long proposalId,
                                     String leaseTokenHash,
                                     String status,
                                     LocalDateTime leaseExpiresAt,
                                     boolean leaseExpired) {
    }

    public static class StaleProposalException extends IllegalStateException {
        public StaleProposalException(String message) {
            super(message);
        }
    }
}
