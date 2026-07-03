package com.getjobs.application.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import com.getjobs.application.dto.ConfirmBatchRequest;
import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.entity.CookieEntity;
import com.getjobs.application.entity.ZhilianConfigEntity;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.OpenClawJobProbeService;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.manager.PlaywrightManager;
import com.getjobs.worker.service.JobRunCoordinator;
import com.getjobs.worker.service.ZhilianJobService;
import lombok.extern.slf4j.Slf4j;
import org.apache.catalina.connector.ClientAbortException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.ArrayList;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Executor;
import java.util.stream.Collectors;

/**
 * 智联招聘控制器（整合版）
 * 提供智联招聘平台配置管理、Cookie管理和登录状态控制的REST API接口
 */
@Slf4j
@RestController
@RequestMapping("/api/zhilian")
public class ZhilianController {
    private static final ObjectMapper objectMapper = new ObjectMapper();

    @Autowired
    private ZhilianService zhilianService;

    @Autowired
    private com.getjobs.application.service.ProfileService profileService;

    @Autowired
    private PlaywrightManager playwrightManager;

    @Autowired
    private CookieService cookieService;

    @Autowired
    private ZhilianJobService zhilianJobService;

    @Autowired
    private JobRunCoordinator jobRunCoordinator;

    @Autowired
    private ChromeJobAnalysisQueueService chromeJobAnalysisQueueService;

    @Autowired
    private OpenClawJobProbeService openClawJobProbeService;

    @Autowired
    @Qualifier("jobTaskExecutor")
    private Executor jobTaskExecutor;

    private final List<SseEmitter> zhilianProgressEmitters = new CopyOnWriteArrayList<>();

    // ==================== 配置管理相关接口 ====================

    /**
     * 获取 智联 配置与可选项
     */
    @GetMapping("/config")
    public Map<String, Object> getAllZhilianConfig() {
        Map<String, Object> result = new HashMap<>();

        ZhilianConfigEntity config = zhilianService.getFirstConfig();
        if (config == null) {
            config = new ZhilianConfigEntity();
        }
        String rawCityCode = config.getCityCode();
        String rawSalary = config.getSalary();
        if (config.getSearchJobLimit() == null) {
            config.setSearchJobLimit(ZhilianService.DEFAULT_SEARCH_JOB_LIMIT);
        } else {
            config.setSearchJobLimit(zhilianService.normalizeSearchJobLimit(config.getSearchJobLimit()));
        }
        config.setCityCode(zhilianService.normalizeCityCode(config.getCityCode()));
        config.setSalary(zhilianService.normalizeSalaryCode(config.getSalary()));

        Map<String, String> warnings = new HashMap<>();
        if (isLegacyZhilianValue(rawCityCode) && !Objects.equals(rawCityCode.trim(), config.getCityCode())) {
            warnings.put("city", "已将旧版城市值改为智联官方城市参数，请确认后保存。");
        }
        if (isLegacyZhilianValue(rawSalary) && !Objects.equals(rawSalary.trim(), config.getSalary())) {
            warnings.put("salary", "已将旧版自定义薪资改为智联官方薪资区间，请重新选择后保存。");
        }

        Map<String, List<Map<String, String>>> options = new HashMap<>();
        options.put("city", toOptionMaps("city"));
        options.put("salary", toOptionMaps("salary"));

        result.put("config", config);
        result.put("options", options);
        result.put("warnings", warnings);
        result.put("currentProfile", profileService.getCurrentProfile());
        result.put("hasProfile", profileService.hasProfiles());
        return result;
    }

    /**
     * 更新 智联 配置（选择性更新第一条记录）
     */
    @PutMapping("/config")
    public ZhilianConfigEntity updateConfig(@RequestBody ZhilianConfigEntity config) {
        return zhilianService.updateConfig(config);
    }

    /**
     * 返回城市选项列表
     */
    @GetMapping("/config/options/city")
    public List<Map<String, String>> getCityOptions() {
        return toOptionMaps("city");
    }

    /**
     * 返回薪资选项列表
     */
    @GetMapping("/config/options/salary")
    public List<Map<String, String>> getSalaryOptions() {
        return toOptionMaps("salary");
    }

    private List<Map<String, String>> toOptionMaps(String type) {
        return zhilianService.getOptionsByType(type).stream().map(e -> {
            Map<String, String> m = new HashMap<>();
            m.put("name", e.getName());
            m.put("code", e.getCode());
            return m;
        }).collect(Collectors.toList());
    }

    private boolean isLegacyZhilianValue(String value) {
        if (value == null || value.isBlank()) return false;
        String trimmed = value.trim();
        return !"0".equals(trimmed) && !"不限".equals(trimmed);
    }

    // ==================== 登录和认证相关接口 ====================

    /**
     * 检查登录状态
     * @return 登录状态信息
     */
    @GetMapping("/login-status")
    public ResponseEntity<Map<String, Object>> checkLoginStatus() {
        Map<String, Object> response = new HashMap<>();

        try {
            boolean isLoggedIn = playwrightManager.isLoggedIn("zhilian");
            response.put("success", true);
            response.put("isLoggedIn", isLoggedIn);
            response.put("message", isLoggedIn ? "已登录" : "未登录");

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("检查登录状态失败", e);
            response.put("success", false);
            response.put("message", "检查登录状态失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 触发智联招聘登录：在未登录时点击二维码入口，等待扫码
     */
    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> triggerZhilianLogin() {
        Map<String, Object> response = new HashMap<>();
        try {
            boolean isLoggedIn = playwrightManager.openZhilianPlatformPage();
            response.put("success", true);
            response.put("platform", "zhilian");
            response.put("isLoggedIn", isLoggedIn);
            response.put("message", isLoggedIn ? "智联招聘页面已打开" : "智联招聘登录页已打开，请扫码登录");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("触发智联登录失败", e);
            response.put("success", false);
            response.put("platform", "zhilian");
            response.put("isLoggedIn", false);
            response.put("message", "触发登录失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 退出登录：清空数据库Cookie并清理运行中的上下文Cookie
     */
    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logoutZhilian() {
        Map<String, Object> response = new HashMap<>();
        try {
            // 更新登录状态为未登录并触发SSE通知
            playwrightManager.setLoginStatus("zhilian", false);

            // 清空数据库中 智联招聘 平台的所有 Cookie 值
            cookieService.clearCookieByPlatform("zhilian", "manual logout");

            // 清理运行中的上下文Cookie
            try {
                playwrightManager.clearZhilianCookies();
            } catch (Exception e) {
                log.warn("清理智联招聘上下文Cookie时发生异常，但不影响退出流程: {}", e.getMessage());
            }

            response.put("success", true);
            response.put("message", "智联招聘已退出登录，数据库Cookie和上下文Cookie均已清理");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("退出登录失败", e);
            response.put("success", false);
            response.put("message", "退出登录失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    // ==================== Cookie管理相关接口 ====================

    /**
     * 调试接口：读取数据库中的 智联招聘 Cookie 记录
     */
    @GetMapping("/cookie")
    public ResponseEntity<Map<String, Object>> getZhilianCookieRecord() {
        Map<String, Object> response = new HashMap<>();
        try {
            CookieEntity cookie = cookieService.getCookieByPlatform("zhilian");
            Map<String, Object> data = new HashMap<>();
            if (cookie != null) {
                data.put("id", cookie.getId());
                data.put("platform", cookie.getPlatform());
                data.put("cookie_value", cookie.getCookieValue());
                data.put("remark", cookie.getRemark());
                data.put("created_at", cookie.getCreatedAt());
                data.put("updated_at", cookie.getUpdatedAt());
            } else {
                data.put("platform", "zhilian");
                data.put("cookie_value", null);
                data.put("message", "未找到智联招聘Cookie记录");
            }
            response.put("success", true);
            response.put("data", data);
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "读取Cookie记录失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 调试接口：主动保存当前上下文中的 智联招聘 Cookie 到数据库
     */
    @PostMapping("/save-cookie")
    public ResponseEntity<Map<String, Object>> saveZhilianCookie() {
        Map<String, Object> response = new HashMap<>();
        try {
            playwrightManager.saveZhilianCookiesToDb("manual save");
            response.put("success", true);
            response.put("message", "已主动保存智联招聘Cookie到数据库");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "保存智联招聘Cookie失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    // ==================== 数据分析与列表 ====================

    /** 投递统计（Dashboard） */
    @GetMapping("/stats")
    public ZhilianService.StatsResponse stats(
            @RequestParam(value = "statuses", required = false) String statuses,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "experience", required = false) String experience,
            @RequestParam(value = "degree", required = false) String degree,
            @RequestParam(value = "minK", required = false) Double minK,
            @RequestParam(value = "maxK", required = false) Double maxK,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "scanRunId", required = false) String scanRunId
    ) {
        java.util.List<String> statusList = null;
        if (statuses != null && !statuses.trim().isEmpty()) {
            statusList = java.util.Arrays.stream(statuses.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(java.util.stream.Collectors.toList());
        }
        return zhilianService.getZhilianStats(statusList, location, experience, degree, minK, maxK, keyword, scanRunId);
    }

    /** 岗位列表（分页 + 筛选） */
    @GetMapping("/list")
    public ZhilianService.PagedResult list(
            @RequestParam(value = "statuses", required = false) String statuses,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "experience", required = false) String experience,
            @RequestParam(value = "degree", required = false) String degree,
            @RequestParam(value = "minK", required = false) Double minK,
            @RequestParam(value = "maxK", required = false) Double maxK,
            @RequestParam(value = "keyword", required = false) String keyword,
            @RequestParam(value = "scanRunId", required = false) String scanRunId,
            @RequestParam(value = "page", required = false, defaultValue = "1") Integer page,
            @RequestParam(value = "size", required = false, defaultValue = "20") Integer size
    ) {
        java.util.List<String> statusList = null;
        if (statuses != null && !statuses.trim().isEmpty()) {
            statusList = java.util.Arrays.stream(statuses.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(java.util.stream.Collectors.toList());
        }
        return zhilianService.listZhilianJobs(statusList, location, experience, degree, minK, maxK, keyword, page, size, scanRunId);
    }

    /** 清空智联投递分析数据，切换候选人或简历前使用。 */
    @DeleteMapping("/analysis")
    public Map<String, Object> clearAnalysis() {
        return zhilianService.clearZhilianAnalysisData();
    }

    @PostMapping("/chrome/jobs")
    public ResponseEntity<Map<String, Object>> receiveChromeJobs(@RequestBody ChromeJobBatchRequest request) {
        Long profileId = profileService.getCurrentProfileId();
        int received = request == null || request.getJobs() == null ? 0 : request.getJobs().size();
        int savedCount = 0;
        int queued = 0;
        int skipped = 0;
        int insufficient = 0;
        int restored = 0;
        String runId = normalizeRunId(request == null ? null : request.getRunId());
        List<Map<String, Object>> analyses = new ArrayList<>();
        if (request != null && request.getJobs() != null) {
            if (jobRunCoordinator.isCancelRequested(runId)) {
                jobRunCoordinator.clearCancel(runId);
                sendZhilianProgress(JobProgressMessage.warning("zhilian", "智联 Chrome扫描已停止，后端未继续处理本批岗位"));
                return ResponseEntity.ok(zhilianChromeJobsResponse(
                        true, true, received, 0, 0, 0, 0, 0, List.of()
                ));
            }
            sendZhilianProgress(JobProgressMessage.info("zhilian", "Chrome已采集到 " + received + " 个智联岗位，正在提交后台AI队列"));
            for (ChromeJobDto dto : request.getJobs()) {
                if (jobRunCoordinator.isCancelRequested(runId)) {
                    jobRunCoordinator.clearCancel(runId);
                    sendZhilianProgress(JobProgressMessage.warning("zhilian", "智联 Chrome扫描已停止，后端已中断剩余岗位入队"));
                    return ResponseEntity.ok(zhilianChromeJobsResponse(
                            true, true, received, savedCount, queued, skipped, insufficient, restored, analyses
                    ));
                }
                ZhilianJobDataEntity entity = toZhilianEntity(dto);
                ZhilianJobDataEntity saved = zhilianService.upsertChromeJob(entity, runId);
                savedCount++;

                if (saved == null) {
                    skipped++;
                    log.warn("智联 Chrome岗位入库返回为空：company={}, title={}, url={}", dto == null ? "" : dto.getCompany(), dto == null ? "" : dto.getTitle(), dto == null ? "" : dto.getUrl());
                    continue;
                }
                String currentStatus = saved.getDeliveryStatus();
                if (DeliveryStatus.AI_ANALYZING.equals(currentStatus)) {
                    skipped++;
                    Map<String, Object> snapshot = toZhilianAnalysisSnapshot(saved);
                    if (snapshot != null) {
                        analyses.add(snapshot);
                        restored++;
                    }
                    continue;
                }
                if (isFinalZhilianStatus(currentStatus)) {
                    skipped++;
                    Map<String, Object> snapshot = toZhilianAnalysisSnapshot(saved);
                    if (snapshot != null) {
                        analyses.add(snapshot);
                        restored++;
                    }
                    continue;
                }
                List<String> missingFields = collectMissingAnalysisFields(saved);
                if (!missingFields.isEmpty()) {
                    insufficient++;
                    markZhilianCollectionInsufficient(saved, profileId, missingFields);
                    ZhilianJobDataEntity display = zhilianService.getZhilianJobById(saved.getId());
                    if (display == null) display = saved;
                    analyses.add(Map.of(
                            "id", display.getId(),
                            "jobKey", Objects.toString(display.getJobId(), ""),
                            "jobName", Objects.toString(display.getJobTitle(), ""),
                            "companyName", Objects.toString(display.getCompanyName(), ""),
                            "score", 0,
                            "decision", DeliveryStatus.COLLECTION_INSUFFICIENT,
                            "shouldApply", false
                    ));
                    String message = "采集信息不足：" + Objects.toString(display.getCompanyName(), "") + " / " + Objects.toString(display.getJobTitle(), "") + "，缺少：" + String.join("、", missingFields);
                    log.warn("{}", message);
                    sendZhilianProgress(JobProgressMessage.warning("zhilian", message));
                    continue;
                }
                if (!isFinalZhilianStatus(currentStatus)) {
                    zhilianService.updateDeliveryStatusByJobId(saved.getJobId(), DeliveryStatus.AI_ANALYZING);
                    saved = zhilianService.getZhilianJobById(saved.getId());
                }

                JobAiAnalysisService.JobAnalysisRequest analysisRequest = new JobAiAnalysisService.JobAnalysisRequest();
                analysisRequest.setProfileId(profileId);
                analysisRequest.setPlatform("zhilian");
                analysisRequest.setJobKey(saved.getJobId());
                analysisRequest.setKeyword(dto.getKeyword() == null ? request.getKeyword() : dto.getKeyword());
                analysisRequest.setCompanyName(saved.getCompanyName());
                analysisRequest.setJobName(saved.getJobTitle());
                analysisRequest.setSalary(saved.getSalary());
                analysisRequest.setLocation(saved.getLocation());
                analysisRequest.setExperience(saved.getExperience());
                analysisRequest.setDegree(saved.getDegree());
                analysisRequest.setCompanyInfo("");
                analysisRequest.setJobDescription(saved.getJobDescription());
                analysisRequest.setScanRunId(runId);
                ChromeJobAnalysisQueueService.AnalysisJob job = new ChromeJobAnalysisQueueService.AnalysisJob();
                job.setRunId(runId);
                job.setCurrentStatus(currentStatus);
                job.setCurrent(savedCount);
                job.setTotal(received);
                job.setRequest(analysisRequest);
                job.setProgressCallback(this::sendZhilianProgress);

                ChromeJobAnalysisQueueService.EnqueueResult enqueueResult = chromeJobAnalysisQueueService.enqueue(job);
                if (enqueueResult.isRejected()) {
                    zhilianService.updateDeliveryStatusByJobId(saved.getJobId(), firstNonBlank(currentStatus, DeliveryStatus.NOT_DELIVERED));
                    Map<String, Object> response = zhilianChromeJobsResponse(
                            false, false, received, savedCount, queued, skipped, insufficient, restored, analyses
                    );
                    response.put("message", enqueueResult.getMessage());
                    return ResponseEntity.status(429).body(response);
                }
                if (enqueueResult.isQueued()) {
                    queued++;
                    sendZhilianProgress(JobProgressMessage.progress(
                            "zhilian",
                            "已加入后台AI队列：" + saved.getJobTitle(),
                            savedCount,
                            received
                    ));
                } else {
                    skipped++;
                }
            }
        }
        sendZhilianProgress(JobProgressMessage.success("zhilian", "智联 Chrome岗位已提交后台AI队列：入库 " + savedCount + " 个，入队 " + queued + " 个，恢复已有分析 " + restored + " 个，信息不足 " + insufficient + " 个"));
        return ResponseEntity.ok(zhilianChromeJobsResponse(
                true, false, received, savedCount, queued, skipped, insufficient, restored, analyses
        ));
    }

    @PostMapping("/chrome/stop")
    public ResponseEntity<Map<String, Object>> stopChromeZhilian(@RequestBody(required = false) Map<String, Object> payload) {
        String runId = payload == null ? null : Objects.toString(payload.get("runId"), "");
        jobRunCoordinator.requestCancel(runId);
        sendZhilianProgress(JobProgressMessage.warning("zhilian", "智联 Chrome扫描停止请求已发送"));
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "智联 Chrome扫描停止请求已发送",
                "runId", runId == null ? "" : runId
        ));
    }

    @GetMapping("/openclaw/status")
    public ResponseEntity<Map<String, Object>> getOpenClawStatus(
            @RequestParam(value = "profile", required = false) String profile) {
        return ResponseEntity.ok(openClawJobProbeService.status(profile));
    }

    @PostMapping("/openclaw/probe")
    public ResponseEntity<Map<String, Object>> probeOpenClaw(@RequestBody(required = false) Map<String, Object> payload) {
        Map<String, Object> request = payload == null ? new HashMap<>() : new HashMap<>(payload);
        request.put("platform", "zhilian");
        Map<String, Object> response = openClawJobProbeService.probe(request);
        if (Boolean.TRUE.equals(response.get("success"))) {
            sendZhilianProgress(JobProgressMessage.info("zhilian", "OpenClaw实验采集完成，等待前端提交现有AI分析入库接口"));
            return ResponseEntity.ok(response);
        }
        sendZhilianProgress(JobProgressMessage.warning("zhilian", Objects.toString(response.get("message"), "OpenClaw实验采集失败")));
        return ResponseEntity.badRequest().body(response);
    }

    @PostMapping("/jobs/{id}/confirm")
    public Map<String, Object> confirmZhilianJob(@PathVariable("id") Long id) {
        ZhilianJobDataEntity job = getZhilianJobById(id);
        Map<String, Object> error = validateDeliverable(job);
        if (error != null) return error;
        return Map.of("success", true, "message", "请在 Chrome 中确认投递该智联岗位", "task", toDeliveryTask(job));
    }

    @PostMapping("/jobs/confirm-batch")
    public Map<String, Object> confirmZhilianBatch(@RequestBody ConfirmBatchRequest request) {
        List<ZhilianJobDataEntity> candidates = new ArrayList<>();
        if (request != null && request.getIds() != null && !request.getIds().isEmpty()) {
            for (Long id : request.getIds()) {
                ZhilianJobDataEntity job = getZhilianJobById(id);
                if (job != null) candidates.add(job);
            }
        } else {
            ZhilianService.PagedResult page = zhilianService.listZhilianJobs(
                    List.of(DeliveryStatus.WAITING_CONFIRM),
                    request == null ? null : request.getLocation(),
                    request == null ? null : request.getExperience(),
                    request == null ? null : request.getDegree(),
                    request == null ? null : request.getMinK(),
                    request == null ? null : request.getMaxK(),
                    request == null ? null : request.getKeyword(),
                    1,
                    500,
                    request == null ? null : request.getScanRunId()
            );
            if (page != null && page.items != null) candidates.addAll(page.items);
        }
        List<Map<String, Object>> tasks = candidates.stream()
                .filter(job -> DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus()))
                .map(this::toDeliveryTask)
                .collect(Collectors.toList());
        return Map.of("success", true, "message", "已生成智联批量 Chrome 投递任务", "tasks", tasks, "count", tasks.size());
    }

    @PostMapping("/jobs/{id}/delivery-result")
    public Map<String, Object> updateZhilianDeliveryResult(@PathVariable("id") Long id, @RequestBody DeliveryResultRequest request) {
        ZhilianJobDataEntity job = getZhilianJobById(id);
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        String status = request != null && Boolean.TRUE.equals(request.getSuccess()) ? DeliveryStatus.DELIVERED : DeliveryStatus.DELIVERY_FAILED;
        String message = request == null ? null : request.getMessage();
        String failureReason = request == null ? null : request.getFailureReason();
        ZhilianJobDataEntity updated = zhilianService.updateDeliveryStatusById(
                id,
                status,
                request == null ? null : request.getFailureType(),
                firstNonBlank(failureReason, message)
        );
        return Map.of("success", true, "message", request == null || request.getMessage() == null ? "投递状态已更新" : request.getMessage(), "status", updated == null ? status : updated.getDeliveryStatus());
    }

    @PostMapping("/jobs/{id}/skip")
    public Map<String, Object> skipZhilianJob(@PathVariable("id") Long id) {
        ZhilianJobDataEntity updated = zhilianService.updateDeliveryStatusById(id, DeliveryStatus.SKIPPED);
        if (updated == null) {
            return Map.of("success", false, "message", "岗位不存在");
        }
        return Map.of("success", true, "message", "已跳过该岗位", "status", DeliveryStatus.SKIPPED);
    }

    // ==================== 任务管理相关接口 ====================

    /**
     * 智联招聘任务进度推送
     */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamZhilianProgress() {
        SseEmitter emitter = new SseEmitter(0L);
        zhilianProgressEmitters.add(emitter);

        emitter.onCompletion(() -> {
            log.info("智联招聘进度SSE连接已完成");
            zhilianProgressEmitters.remove(emitter);
        });
        emitter.onTimeout(() -> {
            log.info("智联招聘进度SSE连接超时");
            zhilianProgressEmitters.remove(emitter);
        });
        emitter.onError(e -> {
            log.error("智联招聘进度SSE连接错误", e);
            zhilianProgressEmitters.remove(emitter);
        });

        try {
            emitter.send(SseEmitter.event().name("connected").data(Map.of("message", "已连接到智联招聘扫描进度推送")));
        } catch (IOException e) {
            log.error("发送智联招聘SSE连接消息失败", e);
        }
        return emitter;
    }

    /**
     * 启动智联招聘自动扫描任务
     * @return 响应结果
     */
    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> startZhilianJob() {
        Map<String, Object> response = new HashMap<>();

        try {
            // 未登录则不允许启动
            if (!playwrightManager.isLoggedIn("zhilian")) {
                response.put("success", false);
                response.put("message", "请先登录智联招聘");
                response.put("status", "not_logged_in");
                return ResponseEntity.badRequest().body(response);
            }

            // 检查是否已有任务在运行
            if (zhilianJobService.isRunning()) {
                response.put("success", false);
                response.put("message", "智联招聘任务已在运行中，请等待当前任务完成");
                response.put("status", "running");
                return ResponseEntity.badRequest().body(response);
            }

            // 异步启动新任务
            CompletableFuture.runAsync(() -> {
                try {
                    zhilianJobService.executeDelivery(progressMessage -> {
                        sendZhilianProgress(progressMessage);
                        log.info("[{}] {}", progressMessage.getPlatform(), progressMessage.getMessage());
                    });
                } catch (Exception e) {
                    log.error("智联异步任务执行失败", e);
                    sendZhilianProgress(JobProgressMessage.error("zhilian", "智联任务执行失败，请查看后端日志"));
                }
            }, jobTaskExecutor);

            response.put("success", true);
            response.put("message", "智联招聘扫描任务启动成功，将生成待确认岗位");
            response.put("status", "started");

            log.info("通过API启动智联招聘扫描任务成功");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("启动智联招聘任务失败", e);
            response.put("success", false);
            response.put("message", "启动智联招聘任务失败: " + e.getMessage());
            response.put("error", e.getClass().getSimpleName());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 停止智联招聘任务
     * @return 响应结果
     */
    @PostMapping("/stop")
    public ResponseEntity<Map<String, Object>> stopZhilianJob() {
        Map<String, Object> response = new HashMap<>();

        try {
            if (!zhilianJobService.isRunning()) {
                response.put("success", false);
                response.put("message", "没有正在运行的智联招聘任务");
                return ResponseEntity.badRequest().body(response);
            }

            zhilianJobService.stopDelivery();

            response.put("success", true);
            response.put("message", "智联招聘任务停止请求已发送");

            log.info("通过API停止智联招聘任务");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("停止智联招聘任务失败", e);
            response.put("success", false);
            response.put("message", "停止智联招聘任务失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 获取当前运行状态
     * @return 当前状态信息
     */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getCurrentStatus() {
        Map<String, Object> response = new HashMap<>();

        try {
            Map<String, Object> status = zhilianJobService.getStatus();
            response.put("success", true);
            response.putAll(status);
            response.put("timestamp", System.currentTimeMillis());

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取当前状态失败", e);
            response.put("success", false);
            response.put("message", "获取状态失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    // ==================== 健康检查接口 ====================

    /**
     * 健康检查接口
     * @return 服务状态
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("service", "ZhilianController");
        response.put("status", "healthy");
        response.put("timestamp", System.currentTimeMillis());

        return ResponseEntity.ok(response);
    }

    // ==================== 辅助方法 ====================

    private void sendZhilianProgress(JobProgressMessage message) {
        List<SseEmitter> deadEmitters = new CopyOnWriteArrayList<>();
        for (SseEmitter emitter : zhilianProgressEmitters) {
            try {
                emitter.send(SseEmitter.event().name("progress").data(objectMapper.writeValueAsString(message)));
            } catch (Exception e) {
                if (e instanceof AsyncRequestNotUsableException ||
                        e instanceof ClientAbortException ||
                        (e.getCause() instanceof ClientAbortException) ||
                        (e instanceof IOException && String.valueOf(e.getMessage()).contains("中止了一个已建立的连接"))) {
                    log.debug("智联招聘进度 SSE 客户端已断开，移除连接: {}", e.getMessage());
                    try { emitter.complete(); } catch (Exception ignored) {}
                } else {
                    log.error("发送智联招聘进度消息失败", e);
                }
                deadEmitters.add(emitter);
            }
        }
        zhilianProgressEmitters.removeAll(deadEmitters);
    }

    private ZhilianJobDataEntity toZhilianEntity(ChromeJobDto dto) {
        ZhilianJobDataEntity entity = new ZhilianJobDataEntity();
        if (dto == null) return entity;
        entity.setJobId(firstNonBlank(dto.getId(), extractUrlId(dto.getUrl())));
        entity.setJobTitle(dto.getTitle());
        entity.setJobLink(dto.getUrl());
        entity.setSalary(dto.getSalary());
        entity.setLocation(dto.getLocation());
        entity.setExperience(dto.getExperience());
        entity.setDegree(dto.getDegree());
        entity.setCompanyName(dto.getCompany());
        entity.setDeliveryStatus(normalizeChromeDeliveryStatus(dto.getDeliveryStatus()));
        entity.setJobDescription(dto.getDescription());
        return entity;
    }

    private String normalizeChromeDeliveryStatus(String status) {
        return DeliveryStatus.normalizeChromeStatus(status);
    }

    private ZhilianJobDataEntity getZhilianJobById(Long id) {
        return zhilianService.getZhilianJobById(id);
    }

    private Map<String, Object> validateDeliverable(ZhilianJobDataEntity job) {
        if (job == null) return Map.of("success", false, "message", "岗位不存在");
        if (!DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus())) {
            return Map.of("success", false, "message", "只有待确认岗位可以确认投递", "status", job.getDeliveryStatus() == null ? "" : job.getDeliveryStatus());
        }
        if (job.getJobLink() == null || job.getJobLink().isBlank()) {
            return Map.of("success", false, "message", "该岗位缺少详情链接，无法在 Chrome 中投递");
        }
        return null;
    }

    private boolean isFinalZhilianStatus(String status) {
        if (status == null || status.isBlank()) return false;
        return DeliveryStatus.isFinalStatus(status);
    }

    private Map<String, Object> toDeliveryTask(ZhilianJobDataEntity job) {
        Map<String, Object> task = new HashMap<>();
        task.put("id", job.getId());
        task.put("platform", "zhilian");
        task.put("url", Objects.toString(job.getJobLink(), ""));
        task.put("companyName", Objects.toString(job.getCompanyName(), ""));
        task.put("jobName", Objects.toString(job.getJobTitle(), ""));
        task.put("salary", Objects.toString(job.getSalary(), ""));
        return task;
    }

    private Map<String, Object> zhilianChromeJobsResponse(boolean success,
                                                          boolean cancelled,
                                                          int received,
                                                          int saved,
                                                          int queued,
                                                          int skipped,
                                                          int insufficient,
                                                          int restored,
                                                          List<Map<String, Object>> analyses) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", success);
        response.put("asyncAnalysis", true);
        if (cancelled) response.put("cancelled", true);
        response.put("received", received);
        response.put("saved", saved);
        response.put("queued", queued);
        response.put("skipped", skipped);
        response.put("restored", restored);
        response.put("insufficient", insufficient);
        response.put("queueSize", chromeJobAnalysisQueueService.queueSize());
        response.put("analyses", analyses == null ? List.of() : analyses);
        return response;
    }

    private String normalizeRunId(String runId) {
        return runId == null || runId.isBlank() ? null : runId.trim();
    }

    private List<String> collectMissingAnalysisFields(ZhilianJobDataEntity job) {
        List<String> missing = new ArrayList<>();
        if (job == null) {
            missing.add("岗位");
            return missing;
        }
        if (isBlank(job.getJobTitle())) missing.add("岗位名称");
        if (isBlank(job.getCompanyName())) missing.add("公司名称");
        if (isBlank(job.getJobLink()) || !isZhilianJobLink(job.getJobLink())) missing.add("岗位链接");
        String description = Objects.toString(job.getJobDescription(), "").trim();
        if (description.length() < 30 || looksLikeCompanyOnlyPage(description)) missing.add("岗位要求");
        return missing;
    }

    private boolean isZhilianJobLink(String url) {
        if (url == null || url.isBlank()) return false;
        String value = url.toLowerCase();
        if (!value.contains("zhaopin.com")) return false;
        if (value.matches(".*(company|gongsi|qiye|enterprise|firm|business|corp).*")) return false;
        return value.contains("/job/") || value.contains("jobs.zhaopin.com") || value.contains("jobdetail");
    }

    private boolean looksLikeCompanyOnlyPage(String text) {
        if (text == null || text.isBlank()) return true;
        String value = text.replaceAll("\\s+", "");
        boolean hasJobText = value.matches(".*(岗位职责|职位描述|任职要求|职位要求|工作职责|工作内容|岗位要求).*");
        boolean companyHeavy = value.matches(".*(公司介绍|企业介绍|工商信息|公司信息|经营范围|企业信息).*");
        return companyHeavy && !hasJobText;
    }

    private void markZhilianCollectionInsufficient(ZhilianJobDataEntity job, Long profileId, List<String> missingFields) {
        if (job == null) return;
        String reason = "缺少：" + String.join("、", missingFields);
        if (!isBlank(job.getJobId())) {
            zhilianService.updateDeliveryStatusByJobId(job.getJobId(), DeliveryStatus.COLLECTION_INSUFFICIENT, profileId, null, reason);
            return;
        }
        if (!isBlank(job.getJobTitle()) && !isBlank(job.getCompanyName())) {
            zhilianService.updateDeliveryStatusByTitleAndCompany(job.getJobTitle(), job.getCompanyName(), DeliveryStatus.COLLECTION_INSUFFICIENT, profileId);
        }
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private Map<String, Object> toZhilianAnalysisSnapshot(ZhilianJobDataEntity job) {
        if (job == null || job.getId() == null) return null;
        Map<String, Object> item = new HashMap<>();
        item.put("id", job.getId());
        item.put("jobKey", Objects.toString(job.getJobId(), ""));
        item.put("jobName", Objects.toString(job.getJobTitle(), ""));
        item.put("companyName", Objects.toString(job.getCompanyName(), ""));
        item.put("score", job.getAiScore() == null ? 0 : job.getAiScore());
        item.put("decision", firstNonBlank(job.getAiDecision(), job.getDeliveryStatus()));
        item.put("deliveryStatus", Objects.toString(job.getDeliveryStatus(), ""));
        item.put("reason", Objects.toString(job.getAiReason(), ""));
        item.put("priorityCompany", job.getPriorityCompany() != null && job.getPriorityCompany() == 1);
        item.put("shouldApply", DeliveryStatus.isWaitingConfirm(job.getDeliveryStatus()) || DeliveryStatus.isDelivered(job.getDeliveryStatus()) || "APPLY".equalsIgnoreCase(Objects.toString(job.getAiDecision(), "")));
        item.put("restored", true);
        return item;
    }

    private String extractUrlId(String url) {
        if (url == null || url.isBlank()) return null;
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("([A-Za-z0-9_-]{8,})").matcher(url);
        String last = null;
        while (matcher.find()) last = matcher.group(1);
        return last;
    }

    private String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }

    /** 心跳 - 智联招聘进度 SSE */
    @Scheduled(fixedRate = 30000)
    public void heartbeatZhilianProgress() {
        if (zhilianProgressEmitters.isEmpty()) return;
        List<SseEmitter> deadEmitters = new CopyOnWriteArrayList<>();
        for (SseEmitter emitter : zhilianProgressEmitters) {
            try {
                emitter.send(SseEmitter.event().name("ping").data("keep-alive"));
            } catch (Exception e) {
                if (e instanceof AsyncRequestNotUsableException ||
                        e instanceof ClientAbortException ||
                        (e.getCause() instanceof ClientAbortException) ||
                        (e instanceof IOException && String.valueOf(e.getMessage()).contains("中止了一个已建立的连接"))) {
                    log.debug("智联招聘进度 SSE 客户端已断开（心跳），移除连接: {}", e.getMessage());
                    try { emitter.complete(); } catch (Exception ignored) {}
                } else {
                    log.error("发送智联招聘进度心跳失败", e);
                }
                deadEmitters.add(emitter);
            }
        }
        zhilianProgressEmitters.removeAll(deadEmitters);
    }

    // 旧枚举构建方法已移除，改为从数据库读取
}
