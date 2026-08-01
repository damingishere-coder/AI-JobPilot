package com.getjobs.application.controller;

import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.dto.ConfirmBatchRequest;
import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.entity.BossConfigEntity;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.BossStatsService;
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

    public BossAnalyticsController(BossService bossService, BossStatsService bossStatsService) {
        this.bossService = bossService;
        this.bossStatsService = bossStatsService;
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
        return bossService.listBossJobs(
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
    }

    /**
     * 刷新 boss_data（列顺序检查 + VACUUM）
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
    public Map<String, Object> confirmPendingJob(@PathVariable("id") Long id) {
        BossJobDataEntity job = bossService.getBossJobById(id);
        Map<String, Object> error = validateDeliverable(job);
        if (error != null) return error;
        return Map.of(
                "success", true,
                "message", "请在 Chrome 中确认投递该岗位",
                "task", toDeliveryTask(job)
        );
    }

    @PostMapping("/jobs/confirm-batch")
    public Map<String, Object> confirmBatch(@RequestBody ConfirmBatchRequest request) {
        List<BossJobDataEntity> candidates = new ArrayList<>();
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
            List<Long> requestedIds = request.getIds().stream()
                    .filter(Objects::nonNull)
                    .distinct()
                    .toList();
            requestedCount = requestedIds.size();
            for (Long id : requestedIds) {
                BossJobDataEntity job = bossService.getBossJobById(id);
                if (job != null) candidates.add(job);
            }
        } else if (aiRecommendedOnly) {
            BossService.PagedResult page = bossService.listBossJobs(
                    List.of(DeliveryStatus.WAITING_CONFIRM),
                    null,
                    null,
                    null,
                    null,
                    null,
                    null,
                    1,
                    5000,
                    false,
                    request == null ? null : request.getScanRunId()
            );
            if (page != null && page.items != null) candidates.addAll(page.items);
        } else if (request != null && request.getIds() != null && !request.getIds().isEmpty()) {
            for (Long id : request.getIds().stream().filter(Objects::nonNull).distinct().toList()) {
                BossJobDataEntity job = bossService.getBossJobById(id);
                if (job != null) candidates.add(job);
            }
        } else {
            BossService.PagedResult page = bossService.listBossJobs(
                    List.of(DeliveryStatus.WAITING_CONFIRM),
                    request == null ? null : request.getLocation(),
                    request == null ? null : request.getExperience(),
                    request == null ? null : request.getDegree(),
                    request == null ? null : request.getMinK(),
                    request == null ? null : request.getMaxK(),
                    request == null ? null : request.getKeyword(),
                    1,
                    500,
                    request != null && Boolean.TRUE.equals(request.getFilterHeadhunter()),
                    request == null ? null : request.getScanRunId(),
                    request == null ? null : request.getMinAiScore()
            );
            if (page != null && page.items != null) candidates.addAll(page.items);
        }

        List<Map<String, Object>> tasks = candidates.stream()
                .filter(job -> manualOverrideAiNotMatch
                        ? DeliveryStatus.AI_NOT_MATCH.equals(Objects.toString(job.getDeliveryStatus(), "").trim())
                        : DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus()))
                .filter(job -> !aiRecommendedOnly || "APPLY".equalsIgnoreCase(Objects.toString(job.getAiDecision(), "")))
                .filter(job -> job.getJobUrl() != null && !job.getJobUrl().isBlank())
                .map(this::toDeliveryTask)
                .collect(Collectors.toList());
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

    @PostMapping("/jobs/{id}/delivery-result")
    public Map<String, Object> updateDeliveryResult(@PathVariable("id") Long id, @RequestBody DeliveryResultRequest request) {
        BossJobDataEntity job = bossService.getBossJobById(id);
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        String status = request != null && Boolean.TRUE.equals(request.getSuccess()) ? DeliveryStatus.DELIVERED : DeliveryStatus.DELIVERY_FAILED;
        String message = request == null ? null : request.getMessage();
        String failureReason = request == null ? null : request.getFailureReason();
        BossJobDataEntity updated = bossService.updateDeliveryStatusById(id, status, request == null ? null : request.getFailureType(), firstNonBlank(failureReason, message));
        return Map.of(
                "success", true,
                "message", message == null ? "投递状态已更新" : message,
                "status", updated.getDeliveryStatus()
        );
    }

    @PostMapping("/jobs/{id}/skip")
    public Map<String, Object> skipPendingJob(@PathVariable("id") Long id) {
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
        if (!DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus())) {
            return Map.of("success", false, "message", "只有待确认岗位可以确认投递", "status", job.getDeliveryStatus() == null ? "" : job.getDeliveryStatus());
        }
        if (job.getJobUrl() == null || job.getJobUrl().isBlank()) {
            return Map.of("success", false, "message", "该岗位缺少详情链接，无法在 Chrome 中投递");
        }
        return null;
    }

    private Map<String, Object> toDeliveryTask(BossJobDataEntity job) {
        Map<String, Object> task = new HashMap<>();
        task.put("id", job.getId());
        task.put("platform", "boss");
        task.put("url", Objects.toString(job.getJobUrl(), ""));
        task.put("companyName", Objects.toString(job.getCompanyName(), ""));
        task.put("jobName", Objects.toString(job.getJobName(), ""));
        task.put("salary", Objects.toString(job.getSalary(), ""));
        task.put("greeting", bossSayHi());
        return task;
    }

    private String bossSayHi() {
        BossConfigEntity config = bossService.getFirstConfig();
        return config == null || config.getSayHi() == null ? "" : config.getSayHi();
    }

    private String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }
}
