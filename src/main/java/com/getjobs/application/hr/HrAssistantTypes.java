package com.getjobs.application.hr;

import java.time.LocalDateTime;
import java.util.List;

public final class HrAssistantTypes {
    private HrAssistantTypes() {
    }

    public enum ProposalStatus {
        OBSERVED,
        GENERATING,
        REVIEW_REQUIRED,
        APPROVED,
        SENDING,
        SENT_CONFIRMED,
        SEND_UNKNOWN,
        BLOCKED,
        SKIPPED,
        EXPIRED
    }

    public enum Classification {
        REPLY,
        NO_REPLY,
        NEEDS_USER,
        INTERVIEW_INVITE,
        OFFER,
        COMPENSATION,
        AVAILABILITY,
        CONTACT_REQUEST,
        DOCUMENT_REQUEST,
        REJECTION,
        SUSPICIOUS
    }

    public enum QqTargetType {
        PRIVATE,
        GROUP
    }

    public record ChatSession(
            String uid,
            String securityId,
            String hrName,
            String companyName,
            String jobName,
            String title,
            String lastMessage,
            String lastTime
    ) {
    }

    public record ChatMessage(String from, String type, String text, String time) {
        public boolean inbound() {
            return "对方".equals(from);
        }
    }

    public record ChatCapture(
            String captureId,
            int unreadCount,
            ChatSession session,
            List<ChatMessage> messages
    ) {
        public ChatCapture {
            messages = messages == null ? List.of() : List.copyOf(messages);
        }
    }

    public record ScanReceipt(
            String scanId,
            int received,
            int processed,
            int duplicates,
            List<String> acknowledgedCaptureIds
    ) {
        public ScanReceipt {
            acknowledgedCaptureIds = acknowledgedCaptureIds == null ? List.of() : List.copyOf(acknowledgedCaptureIds);
        }
    }

    public record ChromeBridgeStatus(
            boolean ready,
            boolean tabBound,
            Integer tabId,
            String url,
            String contentVersion,
            LocalDateTime lastHeartbeatAt,
            int outboxCount,
            String detail
    ) {
    }

    public record SendCommandView(
            String commandId,
            String leaseToken,
            long proposalId,
            String uid,
            String hrName,
            String companyName,
            String jobName,
            String sourceFingerprint,
            ChatMessage expectedLatestInbound,
            String draft,
            LocalDateTime expiresAt
    ) {
    }

    public record CommunicationProfile(
            String expectedSalary,
            String workLocation,
            String availability,
            String interviewAvailability,
            String contactPreference,
            String tone,
            String forbiddenClaims
    ) {
        public static CommunicationProfile empty() {
            return new CommunicationProfile("", "", "", "", "", "简洁、礼貌、积极", "不得编造经历或承诺未知事实");
        }
    }

    public record SettingsView(
            Long profileId,
            CommunicationProfile communicationProfile,
            boolean qqEnabled,
            String napcatWsUrl,
            QqTargetType qqTargetType,
            String qqTargetMasked,
            String qqOperatorMasked,
            boolean qqOperatorConfigured,
            boolean napcatTokenConfigured,
            int retentionDays,
            boolean fullAutoLocked
    ) {
    }

    public record AiDraft(
            Classification classification,
            String replyText,
            String summary,
            List<String> riskTags,
            List<String> missingFacts,
            double confidence
    ) {
        public AiDraft {
            riskTags = riskTags == null ? List.of() : List.copyOf(riskTags);
            missingFacts = missingFacts == null ? List.of() : List.copyOf(missingFacts);
        }
    }

    public record ProposalView(
            Long id,
            Long profileId,
            Long conversationId,
            String confirmationCode,
            String status,
            String classification,
            String hrName,
            String companyName,
            String jobName,
            String sourceMessage,
            String draft,
            String summary,
            List<String> riskTags,
            List<String> missingFacts,
            double confidence,
            int version,
            LocalDateTime expiresAt,
            LocalDateTime updatedAt,
            boolean highValue
    ) {
    }

    public record WatchStatus(
            boolean watching,
            boolean scanRunning,
            String watchSessionId,
            long intervalMs,
            LocalDateTime lastScanAt,
            LocalDateTime nextScanAt,
            String lastError,
            ChromeBridgeStatus chromeBridge,
            boolean napcatConnected,
            boolean fullAutoLocked
    ) {
    }
}
