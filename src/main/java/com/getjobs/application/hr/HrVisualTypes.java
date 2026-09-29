package com.getjobs.application.hr;

import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import java.util.List;

public final class HrVisualTypes {
    private HrVisualTypes() { }
    public static final String PROTOCOL = "2026-09-29-hr-visual-v2";
    public record TargetRequest(long proposalId, int expectedVersion, String draft, boolean sendResume, boolean approved,
                                String approvalSource, boolean resumeSharingConfirmed, String expectedJobName) { }
    public record StartRequest(Long profileId, String protocol, List<TargetRequest> targets,
                               String accountName, boolean accountBindingConfirmed) { }
    public record Seed(String uid, String hrName, String companyName, String jobName, String draft,
                       boolean sendResume, boolean approved, ChatCapture expected) { }
    public record Run(String id, Long profileId, String status, String account, String reason) { }
    public record Target(String id, String runId, long conversationId, Long proposalId, Seed seed, String status, String reason) { }
    public record Step(String id, String commandId, int ordinal, String actionType, String leaseToken) { }
    public record ReconfirmRequest(long proposalId, int expectedVersion, String draft,
                                   boolean confirmed, boolean possibleDuplicateAccepted) { }
    public record ResumeRuleRequest(Long profileId, String protocol, boolean enabled, boolean confirmed,
                                    String accountName, boolean accountBindingConfirmed) { }
}
