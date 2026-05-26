package com.getjobs.application.controller;

import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.dto.ConfirmBatchRequest;
import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.service.BossService;
import org.springframework.web.bind.annotation.*;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;

@RestController
@CrossOrigin(origins = "*")
@RequestMapping("/api/boss")
public class BossAnalyticsController {

    private final BossService bossService;

    public BossAnalyticsController(BossService bossService) {
        this.bossService = bossService;
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
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "filterHeadhunter", required = false) Boolean filterHeadhunter
    ) {
        List<String> statusList = null;
        if (statuses != null && !statuses.trim().isEmpty()) {
            statusList = Arrays.stream(statuses.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(Collectors.toList());
        }
        return bossService.getBossStats(
                statusList,
                location,
                experience,
                degree,
                minK,
                maxK,
                keyword,
                filterHeadhunter != null && filterHeadhunter
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
            @RequestParam(value = "keyword", required = false) String keyword,
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
                filterHeadhunter != null && filterHeadhunter
        );
    }

    /**
     * 刷新 boss_data（列顺序检查 + VACUUM）
     */
    @GetMapping("/reload")
    public Map<String, Object> reload() {
        return bossService.reloadBossData();
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
        if (request != null && request.getIds() != null && !request.getIds().isEmpty()) {
            for (Long id : request.getIds()) {
                BossJobDataEntity job = bossService.getBossJobById(id);
                if (job != null) candidates.add(job);
            }
        } else {
            BossService.PagedResult page = bossService.listBossJobs(
                    List.of("待确认"),
                    request == null ? null : request.getLocation(),
                    request == null ? null : request.getExperience(),
                    request == null ? null : request.getDegree(),
                    request == null ? null : request.getMinK(),
                    request == null ? null : request.getMaxK(),
                    request == null ? null : request.getKeyword(),
                    1,
                    500,
                    request != null && Boolean.TRUE.equals(request.getFilterHeadhunter())
            );
            if (page != null && page.items != null) candidates.addAll(page.items);
        }

        List<Map<String, Object>> tasks = candidates.stream()
                .filter(job -> "待确认".equals(job.getDeliveryStatus()))
                .map(this::toDeliveryTask)
                .collect(Collectors.toList());
        return Map.of(
                "success", true,
                "message", "已生成批量 Chrome 投递任务",
                "tasks", tasks,
                "count", tasks.size()
        );
    }

    @PostMapping("/jobs/{id}/delivery-result")
    public Map<String, Object> updateDeliveryResult(@PathVariable("id") Long id, @RequestBody DeliveryResultRequest request) {
        BossJobDataEntity job = bossService.getBossJobById(id);
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        String status = request != null && Boolean.TRUE.equals(request.getSuccess()) ? "已投递" : "投递失败";
        BossJobDataEntity updated = bossService.updateDeliveryStatusById(id, status);
        return Map.of(
                "success", true,
                "message", request == null || request.getMessage() == null ? "投递状态已更新" : request.getMessage(),
                "status", updated.getDeliveryStatus()
        );
    }

    @PostMapping("/jobs/{id}/skip")
    public Map<String, Object> skipPendingJob(@PathVariable("id") Long id) {
        BossJobDataEntity updated = bossService.updateDeliveryStatusById(id, "已跳过");
        if (updated == null) {
            return Map.of("success", false, "message", "岗位不存在");
        }
        return Map.of("success", true, "message", "已跳过该岗位", "status", "已跳过");
    }

    private Map<String, Object> validateDeliverable(BossJobDataEntity job) {
        if (job == null) {
            return Map.of("success", false, "message", "岗位不存在");
        }
        if (!"待确认".equals(job.getDeliveryStatus())) {
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
        task.put("greeting", "");
        return task;
    }
}
