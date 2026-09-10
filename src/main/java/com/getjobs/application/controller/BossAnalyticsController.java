package com.getjobs.application.controller;

import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.dto.ConfirmBatchRequest;
import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.dto.GreetingConfirmationRequest;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.DeliveryAttemptService;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.BossStatsService;
import com.getjobs.application.service.GreetingDraftService;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@RestController
@RequestMapping("/api/boss")
public class BossAnalyticsController {

    private final BossService bossService;
    private final BossStatsService bossStatsService;
    private final DeliveryAttemptService deliveryAttemptService;
    private final GreetingDraftService greetingDraftService;

    public BossAnalyticsController(BossService bossService,
                                   BossStatsService bossStatsService,
                                   DeliveryAttemptService deliveryAttemptService,
                                   GreetingDraftService greetingDraftService) {
        this.bossService = bossService;
        this.bossStatsService = bossStatsService;
        this.deliveryAttemptService = deliveryAttemptService;
        this.greetingDraftService = greetingDraftService;
    }

    /**
     * 投递分析统计与图表（支持与列表相同的筛选条件）
     */
    @GetMapping("/stats")
    public BossService.StatsResponse getStats(
            @RequestParam(value = "statuses", required = false) String statuses,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "experience", required = false) String experience,
            @RequestParam(value = "degree", required = false) String degree,
            @RequestParam(value = "minK", required = false) Double minK,
            @RequestParam(value = "maxK", required = false) Double maxK,
            @RequestParam(value = "minAiScore", required = false) Integer minAiScore,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "scanRunId", required = false) String scanRunId,
            @RequestParam(value = "filterHeadhunter", required = false) Boolean filterHeadhunter
    ) {
        List<String> statusList = null;
        if (statuses != null && !statuses.trim().isEmpty()) {
            statusList = Arrays.stream(statuses.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(Collectors.toList());
        }
        return bossStatsService.getBossStats(
                statusList,
                location,
                experience,
                degree,
                minK,
                maxK,
                minAiScore,
                keyword,
                filterHeadhunter != null && filterHeadhunter,
                scanRunId
        );
    }

    /**
     * 岗位列表（分页 + 筛选）
     */
    @GetMapping("/list")
    public BossService.PagedResult list(
            @RequestParam(value = "statuses", required = false) String statuses,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "experience", required = false) String experience,
            @RequestParam(value = "degree", required = false) String degree,
            @RequestParam(value = "minK", required = false) Double minK,
            @RequestParam(value = "maxK", required = false) Double maxK,
            @RequestParam(value = "minAiScore", required = false) Integer minAiScore,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "scanRunId", required = false) String scanRunId,
            @RequestParam(value = "filterHeadhunter", required = false) Boolean filterHeadhunter,
            @RequestParam(value = "page", required = false, defaultValue = "1") Integer page,
            @RequestParam(value = "size", required = false, defaultValue = "20") Integer size
    ) {
        List<String> statusList = null;
        if (statuses != null && !statuses.trim().isEmpty()) {
            statusList = Arrays.stream(statuses.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(Collectors.toList());
        }
        BossService.PagedResult result = bossService.listBossJobs(
                statusList,
                location,
                experience,
                degree,
                minK,
                maxK,
                keyword,
                page,
                size,
                filterHeadhunter != null && filterHeadhunter,
                scanRunId,
                minAiScore
        );
        enrichGreetings(result == null ? null : result.items);
        return result;
    }

    /**
     * 刷新 Boss 数据视图；只重新读取统计，不执行 Schema 或数据库维护操作。
     */
    @GetMapping("/reload")
    public Map<String, Object> reload() {
        return bossService.reloadBossData();
    }

    /**
     * 清空 Boss 投递分析数据，切换候选人或简历前使用。
     */
    @DeleteMapping("/analysis")
    public Map<String, Object> clearAnalysis() {
        return bossService.clearBossAnalysisData();
    }

    @PostMapping("/jobs/{id}/confirm")
    public Map<String, Object> confirmPendingJob(
            @PathVariable("id") Long id,
            @RequestBody(required = false) GreetingConfirmationRequest request) {
        Map<String, Object> nativeGreetingError = validateNativeGreetingDisabled();
        if (nativeGreetingError != null) return nativeGreetingError;
        BossJobDataEntity job = bossService.getBossJobById(id);
        Map<String, Object> error = validateDeliverable(job);
        if (error != null) return error;
        GreetingDraftService.GreetingView greeting = greetingDraftService.resolveForJob("boss", id);
        if (greeting.finalGreeting().isBlank()) {
            return Map.of("success", false, "message", "最终沟通话术为空，请先编辑或配置默认话术", "greetingSource", greeting.greetingSource());
        }
        Map<String, Object> greetingError = validateGreetingSnapshot(
                request == null ? null : request.getGreetingSnapshot(), greeting);
        if (greetingError != null) return greetingError;
        DeliveryAttemptService.RequestResult attempt = deliveryAttemptService.requestBoss(
                job.getId(), job.getProfileId(), firstNonBlank(job.getEncryptId(), String.valueOf(job.getId())), false);
        if (!attempt.accepted()) {
            return Map.of("success", false, "message", attempt.message(), "status", Objects.toString(job.getDeliveryStatus(), ""));
        }
        return Map.of(
                "success", true,
                "resumed", !attempt.created(),
                "message", attempt.created() ? "投递请求已创建，请在 Chrome 中等待平台确认" : "已恢复原投递请求，请勿重复创建",
                "task", toDeliveryTask(job, attempt.requestKey(), snapshotGreeting(attempt.requestKey(), greeting))
        );
    }

    @PostMapping("/jobs/confirm-batch")
    public Map<String, Object> confirmBatch(@RequestBody ConfirmBatchRequest request) {
        Map<String, Object> nativeGreetingError = validateNativeGreetingDisabled();
        if (nativeGreetingError != null) return nativeGreetingError;
        boolean aiRecommendedOnly = request != null && Boolean.TRUE.equals(request.getAiRecommendedOnly());
        boolean manualOverrideAiNotMatch = request != null && Boolean.TRUE.equals(request.getManualOverrideAiNotMatch());
        if (aiRecommendedOnly && manualOverrideAiNotMatch) {
            return Map.of(
                    "success", false,
                    "message", "AI推荐投递与人工覆盖投递不能同时启用",
                    "tasks", List.of(),
                    "count", 0
            );
        }
        if (manualOverrideAiNotMatch && (request.getIds() == null || request.getIds().isEmpty())) {
            return Map.of(
                    "success", false,
                    "message", "请先选择需要人工投递的AI不匹配岗位",
                    "tasks", List.of(),
                    "count", 0
            );
        }

        int requestedCount = 0;
        if (manualOverrideAiNotMatch) {
            requestedCount = request.getIds().stream().filter(Objects::nonNull).distinct().toList().size();
        }
        List<BossJobDataEntity> deliverableJobs = deliverableBossJobs(request);
        List<GreetingDraftService.GreetingView> greetings = deliverableJobs.stream()
                .map(job -> greetingDraftService.resolveForJob("boss", job.getId()))
                .toList();
        if (greetings.stream().anyMatch(greeting -> greeting.finalGreeting().isBlank())) {
            return Map.of(
                    "success", false,
                    "message", "批量范围内存在空白沟通话术，请先在预览中逐条补全",
                    "tasks", List.of(),
                    "count", 0
            );
        }
        Map<String, Object> greetingError = validateBatchGreetingSnapshots(request, deliverableJobs, greetings);
        if (greetingError != null) return greetingError;
        List<Map<String, Object>> tasks = new ArrayList<>();
        for (int index = 0; index < deliverableJobs.size(); index++) {
            BossJobDataEntity job = deliverableJobs.get(index);
            GreetingDraftService.GreetingView greeting = greetings.get(index);
            DeliveryAttemptService.RequestResult attempt = deliveryAttemptService.requestBoss(
                    job.getId(),
                    job.getProfileId(),
                    firstNonBlank(job.getEncryptId(), String.valueOf(job.getId())),
                    manualOverrideAiNotMatch
            );
            if (attempt.accepted()) {
                tasks.add(toDeliveryTask(job, attempt.requestKey(), snapshotGreeting(attempt.requestKey(), greeting)));
            }
        }
        if (manualOverrideAiNotMatch && tasks.isEmpty()) {
            return Map.of(
                    "success", false,
                    "message", "所选岗位中没有可人工投递的AI不匹配岗位，请刷新列表后重试",
                    "tasks", List.of(),
                    "count", 0
            );
        }
        int skippedCount = manualOverrideAiNotMatch ? Math.max(0, requestedCount - tasks.size()) : 0;
        String message = manualOverrideAiNotMatch
                ? "已生成 " + tasks.size() + " 个AI不匹配岗位的人工投递任务"
                    + (skippedCount > 0 ? "，跳过 " + skippedCount + " 个不符合条件的岗位" : "")
                : (aiRecommendedOnly ? "已生成 AI 推荐待确认 Chrome 投递任务" : "已生成批量 Chrome 投递任务");
        return Map.of(
                "success", true,
                "message", message,
                "tasks", tasks,
                "count", tasks.size()
        );
    }

    @PostMapping("/jobs/confirm-batch/preview")
    public Map<String, Object> previewBatch(@RequestBody(required = false) ConfirmBatchRequest request) {
        List<Map<String, Object>> items = deliverableBossJobs(request).stream().map(job -> {
            GreetingDraftService.GreetingView greeting = greetingDraftService.resolveForJob("boss", job.getId());
            Map<String, Object> item = new HashMap<>();
            item.put("id", job.getId());
            item.put("companyName", Objects.toString(job.getCompanyName(), ""));
            item.put("jobName", Objects.toString(job.getJobName(), ""));
            item.put("greeting", greeting.finalGreeting());
            item.put("greetingSource", greeting.greetingSource());
            item.put("empty", greeting.finalGreeting().isBlank());
            return item;
        }).toList();
        return Map.of(
                "success", true,
                "items", items,
                "count", items.size(),
                "nativeGreetingDisabledConfirmed", bossService.isNativeGreetingDisabledConfirmed()
        );
    }

    @PostMapping("/jobs/{id}/delivery-result")
    public Map<String, Object> updateDeliveryResult(@PathVariable("id") Long id, @RequestBody DeliveryResultRequest request) {
        BossJobDataEntity job = bossService.getBossJobById(id);
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        if (request == null) return Map.of("success", false, "message", "投递结果不能为空");
        DeliveryAttemptService.State outcome = DeliveryAttemptService.State.parse(request.getOutcome());
        if (outcome == null && request.getSuccess() != null) {
            outcome = Boolean.TRUE.equals(request.getSuccess())
                    ? DeliveryAttemptService.State.CONFIRMED
                    : DeliveryAttemptService.State.FAILED;
        }
        DeliveryAttemptService.GreetingOutcome greetingOutcome =
                DeliveryAttemptService.GreetingOutcome.parse(request.getGreetingOutcome());
        if (greetingOutcome == null && outcome == DeliveryAttemptService.State.UNKNOWN) {
            greetingOutcome = DeliveryAttemptService.GreetingOutcome.UNKNOWN;
        } else if (greetingOutcome == null && outcome == DeliveryAttemptService.State.FAILED) {
            greetingOutcome = DeliveryAttemptService.GreetingOutcome.NOT_SENT;
        }
        DeliveryAttemptService.ResolutionResult result = deliveryAttemptService.resolveBoss(
                job.getProfileId(),
                job.getId(),
                request.getRequestKey(),
                outcome,
                request.getEvidence(),
                request.getMessage(),
                request.getFailureType(),
                firstNonBlank(request.getFailureReason(), request.getMessage()),
                greetingOutcome,
                request.getGreetingEvidence()
        );
        BossJobDataEntity updated = bossService.getBossJobById(id);
        return Map.of(
                "success", result.accepted(),
                "accepted", result.accepted(),
                "idempotent", result.idempotent(),
                "message", result.message(),
                "state", result.state() == null ? "" : result.state().name(),
                "status", updated == null ? "" : Objects.toString(updated.getDeliveryStatus(), "")
        );
    }

    @PostMapping("/jobs/{id}/delivery-reconcile")
    public Map<String, Object> reconcileDeliveryResult(@PathVariable("id") Long id,
                                                       @RequestBody DeliveryResultRequest request) {
        BossJobDataEntity job = bossService.getBossJobById(id);
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        DeliveryAttemptService.State target = request == null
                ? null
                : DeliveryAttemptService.State.parse(request.getOutcome());
        DeliveryAttemptService.ResolutionResult result = deliveryAttemptService.reconcileLatest(
                "boss",
                job.getProfileId(),
                job.getId(),
                firstNonBlank(job.getEncryptId(), String.valueOf(job.getId())),
                target,
                request == null ? null : request.getMessage()
        );
        return Map.of(
                "success", result.accepted(),
                "idempotent", result.idempotent(),
                "message", result.message(),
                "state", result.state() == null ? "" : result.state().name()
        );
    }

    @PostMapping("/jobs/{id}/delivery-retry")
    public Map<String, Object> retryDelivery(
            @PathVariable("id") Long id,
            @RequestBody(required = false) GreetingConfirmationRequest request) {
        Map<String, Object> nativeGreetingError = validateNativeGreetingDisabled();
        if (nativeGreetingError != null) return nativeGreetingError;
        BossJobDataEntity job = bossService.getBossJobById(id);
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        GreetingDraftService.GreetingView greeting = greetingDraftService.resolveForJob("boss", id);
        if (greeting.finalGreeting().isBlank()) {
            return Map.of("success", false, "message", "最终沟通话术为空，请先编辑或配置默认话术");
        }
        Map<String, Object> greetingError = validateGreetingSnapshot(
                request == null ? null : request.getGreetingSnapshot(), greeting);
        if (greetingError != null) return greetingError;
        DeliveryAttemptService.RequestResult attempt = deliveryAttemptService.retryBoss(
                job.getId(),
                job.getProfileId(),
                firstNonBlank(job.getEncryptId(), String.valueOf(job.getId()))
        );
        if (!attempt.accepted()) {
            return Map.of("success", false, "message", attempt.message());
        }
        return Map.of(
                "success", true,
                "resumed", !attempt.created(),
                "message", attempt.created()
                        ? "已创建新的显式重试任务，请再次核对平台结果"
                        : "已恢复原重试任务，未创建重复 attempt",
                "task", toDeliveryTask(job, attempt.requestKey(), snapshotGreeting(attempt.requestKey(), greeting))
        );
    }

    @PostMapping("/jobs/{id}/skip")
    public Map<String, Object> skipPendingJob(@PathVariable("id") Long id) {
        BossJobDataEntity current = bossService.getBossJobById(id);
        if (current != null && DeliveryStatus.isDeliveryLocked(current.getDeliveryStatus())) {
            return Map.of("success", false, "message", "投递已进入请求或结果状态，不能再跳过", "status", current.getDeliveryStatus());
        }
        BossJobDataEntity updated = bossService.updateDeliveryStatusById(id, DeliveryStatus.SKIPPED);
        if (updated == null) {
            return Map.of("success", false, "message", "岗位不存在");
        }
        return Map.of("success", true, "message", "已跳过该岗位", "status", DeliveryStatus.SKIPPED);
    }

    private Map<String, Object> validateDeliverable(BossJobDataEntity job) {
        if (job == null) {
            return Map.of("success", false, "message", "岗位不存在");
        }
        if (!DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus())
                && !DeliveryStatus.DELIVERY_REQUESTED.equals(Objects.toString(job.getDeliveryStatus(), "").trim())) {
            return Map.of("success", false, "message", "只有待确认岗位可以确认投递", "status", job.getDeliveryStatus() == null ? "" : job.getDeliveryStatus());
        }
        if (job.getJobUrl() == null || job.getJobUrl().isBlank()) {
            return Map.of("success", false, "message", "该岗位缺少详情链接，无法在 Chrome 中投递");
        }
        return null;
    }

    private Map<String, Object> toDeliveryTask(BossJobDataEntity job,
                                               String requestKey,
                                               GreetingDraftService.GreetingView greeting) {
        Map<String, Object> task = new HashMap<>();
        task.put("id", job.getId());
        task.put("platform", "boss");
        task.put("url", Objects.toString(job.getJobUrl(), ""));
        task.put("companyName", Objects.toString(job.getCompanyName(), ""));
        task.put("jobName", Objects.toString(job.getJobName(), ""));
        task.put("salary", Objects.toString(job.getSalary(), ""));
        task.put("greeting", greeting.finalGreeting());
        task.put("greetingSource", greeting.greetingSource());
        task.put("requestKey", requestKey);
        return task;
    }

    private GreetingDraftService.GreetingView snapshotGreeting(
            String requestKey, GreetingDraftService.GreetingView greeting) {
        String snapshot = deliveryAttemptService.snapshotGreeting(
                requestKey, greeting.finalGreeting(), greeting.greetingSource());
        return new GreetingDraftService.GreetingView(
                greeting.aiGreeting(), greeting.greetingDraft(), greeting.greetingSource(),
                greeting.greetingUpdatedAt(), firstNonBlank(snapshot, greeting.finalGreeting()));
    }

    private Map<String, Object> validateNativeGreetingDisabled() {
        if (bossService.isNativeGreetingDisabledConfirmed()) return null;
        return Map.of(
                "success", false,
                "message", "请先在 AI 配置页确认已关闭 BOSS 平台自带打招呼语，再创建投递任务",
                "nativeGreetingConfirmationRequired", true
        );
    }

    private Map<String, Object> validateGreetingSnapshot(
            String expectedGreeting, GreetingDraftService.GreetingView current) {
        if (expectedGreeting == null || !Objects.equals(expectedGreeting, current.finalGreeting())) {
            return Map.of(
                    "success", false,
                    "message", "沟通话术已在其他页面变化，请刷新并重新确认",
                    "greetingChanged", true
            );
        }
        return null;
    }

    private Map<String, Object> validateBatchGreetingSnapshots(
            ConfirmBatchRequest request,
            List<BossJobDataEntity> jobs,
            List<GreetingDraftService.GreetingView> greetings) {
        Map<Long, String> snapshots = request == null ? null : request.getGreetingSnapshots();
        for (int index = 0; index < jobs.size(); index++) {
            Long id = jobs.get(index).getId();
            if (snapshots == null || !snapshots.containsKey(id)
                    || !Objects.equals(snapshots.get(id), greetings.get(index).finalGreeting())) {
                return Map.of(
                        "success", false,
                        "message", "批量范围内的话术已变化，请重新预览后再确认",
                        "tasks", List.of(),
                        "count", 0,
                        "greetingChanged", true
                );
            }
        }
        return null;
    }

    private void enrichGreetings(List<BossJobDataEntity> jobs) {
        if (jobs == null) return;
        for (BossJobDataEntity job : jobs) {
            GreetingDraftService.GreetingView greeting = greetingDraftService.resolveForJob("boss", job.getId());
            job.setAiGreeting(greeting.aiGreeting());
            job.setGreetingDraft(greeting.greetingDraft());
            job.setGreetingSource(greeting.greetingSource());
            job.setGreetingUpdatedAt(greeting.greetingUpdatedAt());
            job.setFinalGreeting(greeting.finalGreeting());
        }
    }

    private List<BossJobDataEntity> deliverableBossJobs(ConfirmBatchRequest request) {
        boolean manualOverride = request != null && Boolean.TRUE.equals(request.getManualOverrideAiNotMatch());
        boolean aiRecommendedOnly = request != null && Boolean.TRUE.equals(request.getAiRecommendedOnly());
        return batchCandidates(request).stream()
                .filter(job -> manualOverride
                        ? DeliveryStatus.AI_NOT_MATCH.equals(Objects.toString(job.getDeliveryStatus(), "").trim())
                            || DeliveryStatus.DELIVERY_REQUESTED.equals(Objects.toString(job.getDeliveryStatus(), "").trim())
                        : DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus())
                            || DeliveryStatus.DELIVERY_REQUESTED.equals(Objects.toString(job.getDeliveryStatus(), "").trim()))
                .filter(job -> !aiRecommendedOnly || "APPLY".equalsIgnoreCase(Objects.toString(job.getAiDecision(), "")))
                .filter(job -> job.getJobUrl() != null && !job.getJobUrl().isBlank())
                .toList();
    }

    private List<BossJobDataEntity> batchCandidates(ConfirmBatchRequest request) {
        List<BossJobDataEntity> candidates = new ArrayList<>();
        boolean aiRecommendedOnly = request != null && Boolean.TRUE.equals(request.getAiRecommendedOnly());
        if (request != null && request.getIds() != null && !request.getIds().isEmpty()) {
            for (Long id : request.getIds().stream().filter(Objects::nonNull).distinct().toList()) {
                BossJobDataEntity job = bossService.getBossJobById(id);
                if (job != null) candidates.add(job);
            }
            return candidates;
        }
        BossService.PagedResult page = bossService.listBossJobs(
                List.of(DeliveryStatus.WAITING_CONFIRM, DeliveryStatus.DELIVERY_REQUESTED),
                aiRecommendedOnly ? null : request == null ? null : request.getLocation(),
                aiRecommendedOnly ? null : request == null ? null : request.getExperience(),
                aiRecommendedOnly ? null : request == null ? null : request.getDegree(),
                aiRecommendedOnly ? null : request == null ? null : request.getMinK(),
                aiRecommendedOnly ? null : request == null ? null : request.getMaxK(),
                aiRecommendedOnly ? null : request == null ? null : request.getKeyword(),
                1,
                aiRecommendedOnly ? 5000 : 500,
                !aiRecommendedOnly && request != null && Boolean.TRUE.equals(request.getFilterHeadhunter()),
                request == null ? null : request.getScanRunId(),
                aiRecommendedOnly ? null : request == null ? null : request.getMinAiScore()
        );
        if (page != null && page.items != null) candidates.addAll(page.items);
        return candidates;
    }

    private String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }
}
