package com.getjobs.application.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.ConfigService;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.boss.Boss;
import com.getjobs.worker.boss.BossConfig;
import com.getjobs.worker.manager.PlaywrightManager;
import com.getjobs.worker.service.BossJobService;
import com.getjobs.worker.service.JobRunCoordinator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.catalina.connector.ClientAbortException;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.context.request.async.AsyncRequestNotUsableException;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;
import org.springframework.beans.factory.ObjectProvider;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.ArrayList;
import java.util.List;
import java.util.Objects;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Boss 平台控制器（单平台合并版）：进度 SSE 与任务接口
 */
@Slf4j
@RestController
@RequestMapping("/api/boss")
@CrossOrigin(origins = "*")
@RequiredArgsConstructor
public class BossController {
    private static final ObjectMapper objectMapper = new ObjectMapper();

    private final BossJobService bossJobService;
    private final PlaywrightManager playwrightManager;
    private final CookieService cookieService;
    private final JobRunCoordinator jobRunCoordinator;
    private final ConfigService configService;
    private final ObjectProvider<Boss> bossProvider;
    private final com.getjobs.application.service.BossService bossService;
    private final com.getjobs.application.service.ProfileService profileService;
    private final JobAiAnalysisService jobAiAnalysisService;
    private final ChromeJobAnalysisQueueService chromeJobAnalysisQueueService;

    private final List<SseEmitter> bossProgressEmitters = new CopyOnWriteArrayList<>();

    /** SSE - Boss投递任务进度推送 */
    @GetMapping(value = "/stream", produces = MediaType.TEXT_EVENT_STREAM_VALUE)
    public SseEmitter streamBossProgress() {
        SseEmitter emitter = new SseEmitter(0L); // 永不超时
        bossProgressEmitters.add(emitter);

        emitter.onCompletion(() -> {
            log.info("Boss进度SSE连接已完成");
            bossProgressEmitters.remove(emitter);
        });
        emitter.onTimeout(() -> {
            log.info("Boss进度SSE连接超时");
            bossProgressEmitters.remove(emitter);
        });
        emitter.onError(e -> {
            log.error("Boss进度SSE连接错误", e);
            bossProgressEmitters.remove(emitter);
        });

        try {
            emitter.send(SseEmitter.event().name("connected").data(Map.of("message", "已连接到Boss扫描进度推送")));
        } catch (IOException e) {
            log.error("发送SSE连接消息失败", e);
        }
        return emitter;
    }

    /** POST - 启动Boss投递任务 */
    @PostMapping("/execute")
    public ResponseEntity<Map<String, Object>> executeBoss() {
        if (bossJobService.isRunning()) {
            return ResponseEntity.ok(Map.of(
                    "status", "already_running",
                    "message", "Boss扫描任务已在运行中"
            ));
        }

        CompletableFuture.runAsync(() -> bossJobService.executeDelivery(this::sendBossProgress));

        return ResponseEntity.ok(Map.of(
                "status", "started",
                "message", "Boss扫描任务已启动"
        ));
    }

    @PostMapping("/chrome/jobs")
    public ResponseEntity<Map<String, Object>> receiveChromeJobs(@RequestBody ChromeJobBatchRequest request) {
        Long profileId = profileService.getCurrentProfileId();
        int received = request == null || request.getJobs() == null ? 0 : request.getJobs().size();
        int insertedOrUpdated = 0;
        int queued = 0;
        int skipped = 0;
        int insufficient = 0;
        int restored = 0;
        String runId = normalizeRunId(request == null ? null : request.getRunId());
        boolean autoDeliver = request != null && Boolean.TRUE.equals(request.getAutoDeliver());
        List<Map<String, Object>> analyses = new ArrayList<>();
        if (request != null && request.getJobs() != null) {
            if (jobRunCoordinator.isCancelRequested(runId)) {
                jobRunCoordinator.clearCancel(runId);
                sendBossProgress(JobProgressMessage.warning("boss", "Boss Chrome扫描已停止，后端未继续处理本批岗位"));
                return ResponseEntity.ok(bossChromeJobsResponse(
                        true, true, received, 0, 0, 0, 0, 0, autoDeliver, List.of()
                ));
            }
            sendBossProgress(JobProgressMessage.info("boss", "Chrome已采集到 " + received + " 个Boss岗位，正在提交后台AI队列"));
            for (ChromeJobDto dto : request.getJobs()) {
                if (jobRunCoordinator.isCancelRequested(runId)) {
                    jobRunCoordinator.clearCancel(runId);
                    sendBossProgress(JobProgressMessage.warning("boss", "Boss Chrome扫描已停止，后端已中断剩余岗位入队"));
                    return ResponseEntity.ok(bossChromeJobsResponse(
                            true, true, received, insertedOrUpdated, queued, skipped, insufficient, restored, autoDeliver, analyses
                    ));
                }
                BossJobDataEntity entity = toBossEntity(dto);
                BossJobDataEntity saved = bossService.upsertChromeBossJob(entity, runId);
                insertedOrUpdated++;

                if (saved == null) {
                    log.warn("Boss Chrome岗位入库返回为空：company={}, title={}, url={}", dto == null ? "" : dto.getCompany(), dto == null ? "" : dto.getTitle(), dto == null ? "" : dto.getUrl());
                    continue;
                }

                String currentStatus = saved.getDeliveryStatus();
                if (DeliveryStatus.AI_ANALYZING.equals(currentStatus) || isFinalBossStatus(currentStatus)) {
                    skipped++;
                    Map<String, Object> snapshot = toBossAnalysisSnapshot(saved);
                    if (snapshot != null) {
                        analyses.add(snapshot);
                        restored++;
                    }
                    continue;
                }

                List<String> missingFields = collectMissingAnalysisFields(saved);
                if (!missingFields.isEmpty()) {
                    insufficient++;
                    BossJobDataEntity marked = bossService.markBossJobCollectionInsufficient(saved.getId(), missingFields);
                    BossJobDataEntity display = marked == null ? saved : marked;
                    analyses.add(Map.of(
                            "id", display.getId(),
                            "jobKey", Objects.toString(display.getEncryptId(), ""),
                            "jobName", Objects.toString(display.getJobName(), ""),
                            "companyName", Objects.toString(display.getCompanyName(), ""),
                            "score", 0,
                            "decision", DeliveryStatus.COLLECTION_INSUFFICIENT,
                            "shouldApply", false
                    ));
                    String message = "采集信息不足：" + Objects.toString(display.getCompanyName(), "") + " / " + Objects.toString(display.getJobName(), "") + "，缺少：" + String.join("、", missingFields);
                    log.warn("{}", message);
                    sendBossProgress(JobProgressMessage.warning("boss", message));
                    continue;
                }

                saved = bossService.updateDeliveryStatusById(saved.getId(), DeliveryStatus.AI_ANALYZING);
                JobAiAnalysisService.JobAnalysisRequest analysisRequest = new JobAiAnalysisService.JobAnalysisRequest();
                analysisRequest.setProfileId(profileId);
                analysisRequest.setPlatform("boss");
                analysisRequest.setJobKey(saved.getEncryptId());
                analysisRequest.setKeyword(dto.getKeyword() == null ? request.getKeyword() : dto.getKeyword());
                analysisRequest.setCompanyName(saved.getCompanyName());
                analysisRequest.setJobName(saved.getJobName());
                analysisRequest.setSalary(saved.getSalary());
                analysisRequest.setLocation(saved.getLocation());
                analysisRequest.setExperience(saved.getExperience());
                analysisRequest.setDegree(saved.getDegree());
                analysisRequest.setCompanyInfo(saved.getIntroduce());
                analysisRequest.setJobDescription(saved.getJobDescription());
                analysisRequest.setScanRunId(runId);
                ChromeJobAnalysisQueueService.AnalysisJob job = new ChromeJobAnalysisQueueService.AnalysisJob();
                job.setRunId(runId);
                job.setCurrentStatus(currentStatus);
                job.setCurrent(insertedOrUpdated);
                job.setTotal(received);
                job.setRequest(analysisRequest);
                job.setProgressCallback(this::sendBossProgress);

                ChromeJobAnalysisQueueService.EnqueueResult enqueueResult = chromeJobAnalysisQueueService.enqueue(job);
                if (enqueueResult.isRejected()) {
                    bossService.updateDeliveryStatusById(saved.getId(), firstNonBlank(currentStatus, DeliveryStatus.NOT_DELIVERED));
                    Map<String, Object> response = bossChromeJobsResponse(
                            false, false, received, insertedOrUpdated, queued, skipped, insufficient, restored, autoDeliver, analyses
                    );
                    response.put("message", enqueueResult.getMessage());
                    return ResponseEntity.status(429).body(response);
                }
                if (enqueueResult.isQueued()) {
                    queued++;
                    sendBossProgress(JobProgressMessage.progress(
                            "boss",
                            "已加入后台AI队列：" + saved.getJobName(),
                            insertedOrUpdated,
                            received
                    ));
                } else {
                    skipped++;
                }
            }
        }
        sendBossProgress(JobProgressMessage.success("boss", "Boss Chrome岗位已提交后台AI队列：入库 " + insertedOrUpdated + " 个，入队 " + queued + " 个，恢复已有分析 " + restored + " 个，信息不足 " + insufficient + " 个"));
        return ResponseEntity.ok(bossChromeJobsResponse(
                true, false, received, insertedOrUpdated, queued, skipped, insufficient, restored, autoDeliver, analyses
        ));
    }

    @PostMapping("/chrome/jobs/dedupe")
    public ResponseEntity<Map<String, Object>> dedupeChromeJobs(@RequestBody ChromeJobBatchRequest request) {
        List<ChromeJobDto> jobs = request == null || request.getJobs() == null ? List.of() : request.getJobs();
        List<Map<String, Object>> items = new ArrayList<>();
        int duplicateCount = 0;
        String runId = normalizeRunId(request == null ? null : request.getRunId());
        Long profileId = profileService.getCurrentProfileIdOrNull();
        Map<Integer, BossJobDataEntity> existingJobs = bossService.findExistingChromeBossJobs(profileId, jobs, runId);

        for (int index = 0; index < jobs.size(); index++) {
            ChromeJobDto dto = jobs.get(index);
            String id = firstNonBlank(dto == null ? null : dto.getId(), dto == null ? null : extractBossId(dto.getUrl()));
            String company = dto == null ? "" : Objects.toString(dto.getCompany(), "");
            String title = dto == null ? "" : Objects.toString(dto.getTitle(), "");
            BossJobDataEntity existing = existingJobs.get(index);
            boolean duplicate = existing != null;
            if (duplicate) duplicateCount++;
            String reason = "";
            if (duplicate) {
                reason = id != null && !id.isBlank() && id.equals(Objects.toString(existing.getEncryptId(), "")) ? "jobId" : "companyTitle";
            }
            items.add(Map.of(
                    "id", Objects.toString(id, ""),
                    "url", dto == null ? "" : Objects.toString(dto.getUrl(), ""),
                    "title", title,
                    "company", company,
                    "duplicate", duplicate,
                    "reason", reason
            ));
        }

        return ResponseEntity.ok(Map.of(
                "success", true,
                "items", items,
                "duplicateCount", duplicateCount,
                "newCount", Math.max(0, jobs.size() - duplicateCount)
        ));
    }

    @PostMapping("/chrome/stop")
    public ResponseEntity<Map<String, Object>> stopChromeBoss(@RequestBody(required = false) Map<String, Object> payload) {
        String runId = payload == null ? null : Objects.toString(payload.get("runId"), "");
        jobRunCoordinator.requestCancel(runId);
        sendBossProgress(JobProgressMessage.warning("boss", "Boss Chrome扫描停止请求已发送"));
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Boss Chrome扫描停止请求已发送",
                "runId", runId == null ? "" : runId
        ));
    }

    @PostMapping("/ai-keywords")
    public ResponseEntity<Map<String, Object>> generateBossAiKeywords(@RequestBody(required = false) Map<String, Object> payload) {
        List<String> existingKeywords = new ArrayList<>();
        int limit = 5;
        if (payload != null) {
            Object existing = payload.get("existingKeywords");
            if (existing instanceof List<?> list) {
                for (Object item : list) {
                    if (item != null && !String.valueOf(item).trim().isEmpty()) {
                        existingKeywords.add(String.valueOf(item).trim());
                    }
                }
            }
            Object rawLimit = payload.get("limit");
            if (rawLimit instanceof Number number) {
                limit = number.intValue();
            }
        }
        try {
            List<String> keywords = jobAiAnalysisService.generateBossSearchKeywords(existingKeywords, limit);
            return ResponseEntity.ok(Map.of(
                    "success", true,
                    "keywords", keywords,
                    "limit", Math.min(Math.max(limit, 1), 5)
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage(),
                    "keywords", List.of()
            ));
        }
    }

    /** POST - 启动Boss投递任务（前端使用的接口）*/
    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> startBoss() {
        Map<String, Object> response = new HashMap<>();
        try {
            PlaywrightManager.BossSearchSessionStatus sessionStatus =
                    playwrightManager.verifyBossSearchSession(buildBossProbeSearchUrl());
            if (!sessionStatus.searchReady()) {
                response.put("success", false);
                response.put("message", sessionStatus.failureReason());
                response.put("status", "search_not_ready");
                response.put("homeLoggedIn", sessionStatus.homeLoggedIn());
                response.put("searchReady", sessionStatus.searchReady());
                response.put("currentUrl", sessionStatus.currentUrl());
                response.put("debugUrl", buildBossDebugUrl());
                return ResponseEntity.badRequest().body(response);
            }
            if (bossJobService.isRunning()) {
                response.put("success", false);
                response.put("message", "Boss任务已在运行中，请等待当前任务完成");
                response.put("status", "running");
                return ResponseEntity.badRequest().body(response);
            }
            CompletableFuture.runAsync(() -> bossJobService.executeDelivery(pm -> {
                sendBossProgress(pm);
                log.info("[{}] {}", pm.getPlatform(), pm.getMessage());
            }));
            response.put("success", true);
            response.put("message", "Boss扫描任务启动成功，将生成待确认岗位");
            response.put("status", "started");
            log.info("通过API启动Boss扫描任务成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("启动Boss任务失败", e);
            response.put("success", false);
            response.put("message", "启动Boss任务失败: " + e.getMessage());
            response.put("error", e.getClass().getSimpleName());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /** POST - 打开或恢复 Boss 平台登录页 */
    @PostMapping("/login")
    public ResponseEntity<Map<String, Object>> loginBoss() {
        Map<String, Object> response = new HashMap<>();
        try {
            boolean isLoggedIn = playwrightManager.openBossPlatformPage();
            PlaywrightManager.BossSearchSessionStatus sessionStatus = playwrightManager.verifyBossSearchSession(buildBossProbeSearchUrl());
            response.put("success", true);
            response.put("platform", "boss");
            response.put("isLoggedIn", sessionStatus.searchReady());
            response.put("homeLoggedIn", sessionStatus.homeLoggedIn());
            response.put("searchReady", sessionStatus.searchReady());
            response.put("currentUrl", sessionStatus.currentUrl());
            response.put("failureReason", sessionStatus.failureReason());
            response.put("debugUrl", buildBossDebugUrl());
            response.put("message", sessionStatus.searchReady()
                    ? "Boss搜索页已就绪，可以开始扫描"
                    : (isLoggedIn ? "Boss页面已打开，但搜索页仍需完成安全校验" : "Boss登录页已打开，请在后端自动化浏览器完成扫码/安全校验"));
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("打开Boss登录页失败", e);
            response.put("success", false);
            response.put("platform", "boss");
            response.put("isLoggedIn", false);
            response.put("message", "打开Boss登录页失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /** GET - 检查并刷新 Boss 登录状态 */
    @GetMapping("/login-status")
    public ResponseEntity<Map<String, Object>> checkBossLoginStatus() {
        Map<String, Object> response = new HashMap<>();
        try {
            boolean homeLoggedIn = playwrightManager.refreshBossLoginStatus();
            PlaywrightManager.BossSearchSessionStatus sessionStatus = playwrightManager.verifyBossSearchSession(buildBossProbeSearchUrl());
            response.put("success", true);
            response.put("platform", "boss");
            response.put("isLoggedIn", sessionStatus.searchReady());
            response.put("homeLoggedIn", homeLoggedIn || sessionStatus.homeLoggedIn());
            response.put("searchReady", sessionStatus.searchReady());
            response.put("currentUrl", sessionStatus.currentUrl());
            response.put("failureReason", sessionStatus.failureReason());
            response.put("debugUrl", buildBossDebugUrl());
            response.put("message", sessionStatus.searchReady() ? "Boss搜索页已就绪" : sessionStatus.failureReason());
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("检查Boss登录状态失败", e);
            response.put("success", false);
            response.put("platform", "boss");
            response.put("isLoggedIn", false);
            response.put("message", "检查Boss登录状态失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /** POST - 停止Boss投递任务 */
    @PostMapping("/stop")
    public ResponseEntity<Map<String, Object>> stopBoss() {
        Map<String, Object> response = new HashMap<>();
        try {
            if (!bossJobService.isRunning()) {
                response.put("success", false);
                response.put("message", "没有正在运行的Boss任务");
                return ResponseEntity.badRequest().body(response);
            }
            bossJobService.stopDelivery();
            response.put("success", true);
            response.put("message", "Boss任务停止请求已发送");
            log.info("通过API停止Boss任务");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("停止Boss任务失败", e);
            response.put("success", false);
            response.put("message", "停止Boss任务失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /** POST - 退出Boss登录 */
    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logoutBoss() {
        Map<String, Object> response = new HashMap<>();
        try {
            playwrightManager.setLoginStatus("boss", false);
            cookieService.clearCookieByPlatform("boss", "manual logout");
            try { 
                playwrightManager.clearBossCookies(); 
            } catch (Exception e) { 
                log.warn("清理Boss上下文Cookie异常: {}", e.getMessage()); 
            }
            response.put("success", true);
            response.put("message", "Boss已退出登录，数据库Cookie和上下文Cookie均已清理");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("退出登录失败", e);
            response.put("success", false);
            response.put("message", "退出登录失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /** GET - 获取Boss任务状态 */
    @GetMapping("/status")
    public ResponseEntity<Map<String, Object>> getBossStatus() {
        Map<String, Object> status = new HashMap<>(bossJobService.getStatus());
        status.putAll(playwrightManager.getBossLoginDetails());
        status.put("isLoggedIn", Boolean.TRUE.equals(status.get("searchReady")));
        status.put("debugUrl", buildBossDebugUrl());
        return ResponseEntity.ok(status);
    }

    @PostMapping("/verify-search-session")
    public ResponseEntity<Map<String, Object>> verifyBossSearchSession() {
        PlaywrightManager.BossSearchSessionStatus sessionStatus =
                playwrightManager.verifyBossSearchSession(buildBossProbeSearchUrl());
        Map<String, Object> response = new HashMap<>();
        response.put("success", sessionStatus.searchReady());
        response.put("platform", "boss");
        response.put("isLoggedIn", sessionStatus.searchReady());
        response.put("homeLoggedIn", sessionStatus.homeLoggedIn());
        response.put("searchReady", sessionStatus.searchReady());
        response.put("currentUrl", sessionStatus.currentUrl());
        response.put("failureReason", sessionStatus.failureReason());
        response.put("debugUrl", buildBossDebugUrl());
        response.put("message", sessionStatus.searchReady() ? "Boss搜索页已就绪" : sessionStatus.failureReason());
        return sessionStatus.searchReady() ? ResponseEntity.ok(response) : ResponseEntity.badRequest().body(response);
    }

    @GetMapping("/debug-url")
    public ResponseEntity<Map<String, Object>> getBossDebugUrl() {
        return ResponseEntity.ok(Map.of(
                "success", true,
                "debugUrl", buildBossDebugUrl(),
                "message", "请在Boss配置页的后端浏览器画面中完成登录/安全验证"
        ));
    }

    @GetMapping("/browser-snapshot")
    public ResponseEntity<Map<String, Object>> getBossBrowserSnapshot() {
        return ResponseEntity.ok(playwrightManager.getBossPageSnapshot());
    }

    @PostMapping("/browser-click")
    public ResponseEntity<Map<String, Object>> clickBossBrowser(@RequestBody Map<String, Object> payload) {
        double x = ((Number) payload.getOrDefault("x", 0)).doubleValue();
        double y = ((Number) payload.getOrDefault("y", 0)).doubleValue();
        Map<String, Object> result = playwrightManager.clickBossPage(x, y);
        return Boolean.TRUE.equals(result.get("success"))
                ? ResponseEntity.ok(result)
                : ResponseEntity.badRequest().body(result);
    }

    @PostMapping("/browser-drag")
    public ResponseEntity<Map<String, Object>> dragBossBrowser(@RequestBody Map<String, Object> payload) {
        double fromX = ((Number) payload.getOrDefault("fromX", 0)).doubleValue();
        double fromY = ((Number) payload.getOrDefault("fromY", 0)).doubleValue();
        double toX = ((Number) payload.getOrDefault("toX", 0)).doubleValue();
        double toY = ((Number) payload.getOrDefault("toY", 0)).doubleValue();
        Map<String, Object> result = playwrightManager.dragBossPage(fromX, fromY, toX, toY);
        return Boolean.TRUE.equals(result.get("success"))
                ? ResponseEntity.ok(result)
                : ResponseEntity.badRequest().body(result);
    }

    private String buildBossProbeSearchUrl() {
        try {
            BossConfig config = configService.getBossConfig();
            Boss boss = bossProvider.getObject();
            boss.setConfig(config);
            return boss.buildProbeSearchUrl();
        } catch (Exception e) {
            String keyword = URLEncoder.encode("AI产品运营", StandardCharsets.UTF_8);
            return "https://www.zhipin.com/web/geek/job?city=101280600&query=" + keyword;
        }
    }

    private String buildBossDebugUrl() {
        return "/boss#boss-backend-browser";
    }

    private BossJobDataEntity toBossEntity(ChromeJobDto dto) {
        BossJobDataEntity entity = new BossJobDataEntity();
        if (dto == null) return entity;
        entity.setEncryptId(firstNonBlank(dto.getId(), extractBossId(dto.getUrl())));
        entity.setEncryptUserId(dto.getUserId());
        entity.setCompanyName(dto.getCompany());
        entity.setJobName(dto.getTitle());
        entity.setSalary(dto.getSalary());
        entity.setLocation(dto.getLocation());
        entity.setExperience(dto.getExperience());
        entity.setDegree(dto.getDegree());
        entity.setHrName(dto.getHrName());
        entity.setHrPosition(dto.getHrTitle());
        entity.setHrActiveStatus(dto.getHrActive());
        entity.setDeliveryStatus(normalizeChromeDeliveryStatus(dto.getDeliveryStatus()));
        entity.setJobDescription(dto.getDescription());
        entity.setJobUrl(dto.getUrl());
        entity.setRecruitmentStatus(dto.getRecruitmentStatus());
        entity.setCompanyAddress(dto.getCompanyAddress());
        entity.setIndustry(dto.getIndustry());
        entity.setIntroduce(dto.getCompanyInfo());
        entity.setFinancingStage(dto.getFinancingStage());
        entity.setCompanyScale(dto.getCompanyScale());
        return entity;
    }

    private String normalizeChromeDeliveryStatus(String status) {
        return DeliveryStatus.normalizeChromeStatus(status);
    }

    private List<String> collectMissingAnalysisFields(BossJobDataEntity job) {
        List<String> missing = new ArrayList<>();
        if (job == null) {
            missing.add("岗位");
            return missing;
        }
        if (isBlank(job.getJobName())) missing.add("岗位名称");
        if (isBlank(job.getCompanyName())) missing.add("公司名称");
        if (isBlank(job.getJobUrl())) missing.add("岗位链接");
        String detailText = firstNonBlank(job.getJobDescription(), job.getIntroduce());
        if (isBlank(detailText) || detailText.trim().length() < 30) missing.add("岗位要求");
        return missing;
    }

    private boolean isFinalBossStatus(String status) {
        if (status == null || status.isBlank()) return false;
        return DeliveryStatus.isFinalStatus(status);
    }

    private Map<String, Object> bossChromeJobsResponse(boolean success,
                                                       boolean cancelled,
                                                       int received,
                                                       int saved,
                                                       int queued,
                                                       int skipped,
                                                       int insufficient,
                                                       int restored,
                                                       boolean autoDeliver,
                                                       List<Map<String, Object>> analyses) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", success);
        response.put("asyncAnalysis", true);
        if (cancelled) response.put("cancelled", true);
        response.put("received", received);
        response.put("saved", saved);
        response.put("queued", queued);
        response.put("skipped", skipped);
        response.put("insufficient", insufficient);
        response.put("restored", restored);
        response.put("autoDeliver", autoDeliver);
        response.put("queueSize", chromeJobAnalysisQueueService.queueSize());
        response.put("tasks", List.of());
        response.put("analyses", analyses == null ? List.of() : analyses);
        return response;
    }

    private String normalizeRunId(String runId) {
        return runId == null || runId.isBlank() ? null : runId.trim();
    }

    private Map<String, Object> toBossAnalysisSnapshot(BossJobDataEntity job) {
        if (job == null || job.getId() == null) return null;
        Map<String, Object> item = new HashMap<>();
        item.put("id", job.getId());
        item.put("jobKey", Objects.toString(job.getEncryptId(), ""));
        item.put("jobName", Objects.toString(job.getJobName(), ""));
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

    private Map<String, Object> toDeliveryTask(BossJobDataEntity job) {
        Map<String, Object> task = new HashMap<>();
        if (job == null) return task;
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
        com.getjobs.application.entity.BossConfigEntity config = bossService.getFirstConfig();
        return config == null || config.getSayHi() == null ? "" : config.getSayHi();
    }

    private String extractBossId(String url) {
        if (url == null) return null;
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("/job_detail/([^/?#]+)").matcher(url);
        return matcher.find() ? matcher.group(1) : null;
    }

    private String firstNonBlank(String first, String second) {
        return first != null && !first.isBlank() ? first : second;
    }

    private boolean isBlank(String value) {
        return value == null || value.isBlank();
    }

    private void sendBossProgress(JobProgressMessage message) {
        List<SseEmitter> deadEmitters = new CopyOnWriteArrayList<>();
        for (SseEmitter emitter : bossProgressEmitters) {
            try {
                emitter.send(SseEmitter.event().name("progress").data(objectMapper.writeValueAsString(message)));
            } catch (Exception e) {
                if (e instanceof AsyncRequestNotUsableException ||
                        e instanceof ClientAbortException ||
                        (e.getCause() instanceof ClientAbortException) ||
                        (e instanceof IOException && String.valueOf(e.getMessage()).contains("中止了一个已建立的连接"))) {
                    log.debug("Boss进度 SSE 客户端已断开，移除连接: {}", e.getMessage());
                    try { emitter.complete(); } catch (Exception ignored) {}
                } else {
                    log.error("发送Boss进度消息失败", e);
                }
                deadEmitters.add(emitter);
            }
        }
        bossProgressEmitters.removeAll(deadEmitters);
    }

    /** 心跳 - Boss进度 SSE */
    @Scheduled(fixedRate = 30000)
    public void heartbeatBossProgress() {
        if (bossProgressEmitters.isEmpty()) return;
        List<SseEmitter> deadEmitters = new CopyOnWriteArrayList<>();
        for (SseEmitter emitter : bossProgressEmitters) {
            try {
                emitter.send(SseEmitter.event().name("ping").data("keep-alive"));
            } catch (Exception e) {
                if (e instanceof AsyncRequestNotUsableException ||
                        e instanceof ClientAbortException ||
                        (e.getCause() instanceof ClientAbortException) ||
                        (e instanceof IOException && String.valueOf(e.getMessage()).contains("中止了一个已建立的连接"))) {
                    log.debug("Boss进度 SSE 客户端已断开（心跳），移除连接: {}", e.getMessage());
                    try { emitter.complete(); } catch (Exception ignored) {}
                } else {
                    log.error("发送Boss进度心跳失败", e);
                }
                deadEmitters.add(emitter);
            }
        }
        bossProgressEmitters.removeAll(deadEmitters);
    }
}
