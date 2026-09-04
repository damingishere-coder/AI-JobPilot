package com.getjobs.application.controller;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.dto.BrowserClickRequest;
import com.getjobs.application.dto.BrowserDragRequest;
import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.ConfigService;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.JobKeywordCodec;
import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.boss.Boss;
import com.getjobs.worker.boss.BossConfig;
import com.getjobs.worker.manager.PlaywrightManager;
import com.getjobs.worker.service.BossJobService;
import com.getjobs.worker.service.JobRunCoordinator;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.catalina.connector.ClientAbortException;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.core.env.Environment;
import org.springframework.core.env.Profiles;
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
import java.util.concurrent.CopyOnWriteArrayList;

/**
 * Boss 平台控制器（单平台合并版）：进度 SSE 与任务接口
 */
@Slf4j
@RestController
@RequestMapping("/api/boss")
@RequiredArgsConstructor
public class BossController {
    private static final ObjectMapper objectMapper = new ObjectMapper();
    private static final double MAX_BROWSER_COORDINATE = 10000.0;
    private static final String BOSS_BACKEND_SCAN_DISABLED_MESSAGE =
            "Boss后端托管扫描已禁用。Boss扫描已改用 Chrome Bridge，请刷新前端页面，并在已登录 Boss 的 Chrome 页面点击“开始扫描”。";

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
    private final Environment environment;

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
        return bossBackendScanDisabledResponse();
    }

    @PostMapping("/chrome/jobs")
    public ResponseEntity<Map<String, Object>> receiveChromeJobs(@RequestBody ChromeJobBatchRequest request) {
        ResponseEntity<Map<String, Object>> profileError = validateChromeProfile(request == null ? null : request.getProfileId());
        if (profileError != null) return profileError;
        Long profileId = request.getProfileId();
        int received = request == null || request.getJobs() == null ? 0 : request.getJobs().size();
        int insertedOrUpdated = 0;
        int queued = 0;
        int skipped = 0;
        int insufficient = 0;
        int restored = 0;
        int listCollected = 0;
        String runId = normalizeRunId(request == null ? null : request.getRunId());
        // 兼容旧版扩展继续传入 autoDeliver，但扫描阶段永远不生成真实投递任务。
        boolean autoDeliver = false;
        boolean listOnlyCollection = isListOnlyCollection(request);
        List<Map<String, Object>> analyses = new ArrayList<>();
        List<Map<String, Object>> collectionWarnings = new ArrayList<>();
        List<Map<String, Object>> rejected = new ArrayList<>();
        if (request != null && request.getJobs() != null) {
            if (jobRunCoordinator.isCancelRequested(runId)) {
                jobRunCoordinator.clearCancel(runId);
                sendBossProgress(profileId, JobProgressMessage.warning("boss", "Boss Chrome扫描已停止，后端未继续处理本批岗位"));
                return ResponseEntity.ok(decorateListCollectionResponse(
                        bossChromeJobsResponse(true, true, received, 0, 0, 0, 0, 0, autoDeliver, List.of()),
                        listOnlyCollection, 0, List.of()
                ));
            }
            sendBossProgress(profileId, JobProgressMessage.info(
                    "boss",
                    listOnlyCollection
                            ? "Chrome已采集到 " + received + " 个Boss列表岗位，正在按LIST_COLLECTED入库"
                            : "Chrome已采集到 " + received + " 个Boss岗位，正在提交后台AI队列"
            ));
            for (ChromeJobDto dto : request.getJobs()) {
                if (jobRunCoordinator.isCancelRequested(runId)) {
                    jobRunCoordinator.clearCancel(runId);
                    sendBossProgress(profileId, JobProgressMessage.warning("boss", "Boss Chrome扫描已停止，后端已中断剩余岗位入队"));
                    return ResponseEntity.ok(decorateListCollectionResponse(
                            bossChromeJobsResponse(true, true, received, insertedOrUpdated, queued, skipped, insufficient, restored, autoDeliver, analyses),
                            listOnlyCollection, listCollected, collectionWarnings
                    ));
                }
                try {
                    if (isHistoricalReuse(dto)) {
                        BossJobDataEntity restoredJob = restoreHistoricalBossJob(profileId, dto, runId);
                        skipped++;
                        Map<String, Object> snapshot = toBossAnalysisSnapshot(restoredJob);
                        if (snapshot != null) {
                            analyses.add(snapshot);
                            restored++;
                        }
                        continue;
                    }

                    BossJobDataEntity entity = toBossEntity(dto, request.getKeyword());
                    BossJobDataEntity saved = bossService.upsertChromeBossJob(entity, runId, profileId);
                    insertedOrUpdated++;

                    if (saved == null) {
                        skipped++;
                        rejected.add(chromeJobRejection(dto, "Boss 岗位入库未返回有效记录"));
                        continue;
                    }
                    validateBossSavedIdentity(profileId, dto, saved);

                    String currentStatus = saved.getDeliveryStatus();
                    if (listOnlyCollection) {
                        if (DeliveryStatus.AI_ANALYZING.equals(currentStatus) || isFinalBossStatus(currentStatus)) {
                            skipped++;
                        } else {
                            BossJobDataEntity updated = bossService.updateDeliveryStatusById(saved.getId(), DeliveryStatus.LIST_COLLECTED);
                            if (updated != null && DeliveryStatus.LIST_COLLECTED.equals(updated.getDeliveryStatus())) {
                                saved = updated;
                                listCollected++;
                            } else {
                                skipped++;
                                saved = updated == null ? saved : updated;
                            }
                        }
                        List<String> missingListFields = collectMissingListFields(dto, saved, request.getKeyword());
                        if (!missingListFields.isEmpty()) {
                            Map<String, Object> warning = Map.of(
                                    "id", saved.getId() == null ? 0L : saved.getId(),
                                    "title", dto == null ? "" : Objects.toString(dto.getTitle(), ""),
                                    "company", dto == null ? "" : Objects.toString(dto.getCompany(), ""),
                                    "missingFields", missingListFields,
                                    "reason", "Boss列表页字段不完整，已按LIST_COLLECTED入库，未进入AI分析"
                            );
                            collectionWarnings.add(warning);
                            sendBossProgress(profileId, JobProgressMessage.warning(
                                    "boss",
                                    "Boss列表岗位已入库但字段不完整：" + warning.get("company") + " / " + warning.get("title")
                                            + "，缺少：" + String.join("、", missingListFields)
                            ));
                        }
                        continue;
                    }
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
                        BossJobDataEntity marked = bossService.markBossJobCollectionInsufficient(saved.getId(), missingFields);
                        BossJobDataEntity display = marked == null ? saved : marked;
                        if (!DeliveryStatus.COLLECTION_INSUFFICIENT.equals(display.getDeliveryStatus())) {
                            skipped++;
                            Map<String, Object> snapshot = toBossAnalysisSnapshot(display);
                            if (snapshot != null) analyses.add(snapshot);
                            continue;
                        }
                        insufficient++;
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
                        sendBossProgress(profileId, JobProgressMessage.warning("boss", message));
                        continue;
                    }

                    JobAiAnalysisService.JobAnalysisRequest analysisRequest = new JobAiAnalysisService.JobAnalysisRequest();
                    analysisRequest.setProfileId(profileId);
                    analysisRequest.setPlatform("boss");
                    analysisRequest.setJobKey(saved.getEncryptId());
                    analysisRequest.setJobRowId(saved.getId());
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
                    job.setProgressCallback(message -> sendBossProgress(profileId, message));

                    ChromeJobAnalysisQueueService.EnqueueResult enqueueResult = chromeJobAnalysisQueueService.enqueue(job);
                    if (enqueueResult.isRejected()) {
                        skipped++;
                        rejected.add(chromeJobRejection(dto, Objects.toString(enqueueResult.getMessage(), "AI 分析任务被拒绝")));
                        continue;
                    }
                    if (enqueueResult.isQueued()) {
                        queued++;
                        sendBossProgress(profileId, JobProgressMessage.progress(
                                "boss",
                                "已加入后台AI队列：" + saved.getJobName(),
                                insertedOrUpdated,
                                received
                        ));
                    } else {
                        skipped++;
                    }
                } catch (Exception exception) {
                    skipped++;
                    rejected.add(chromeJobRejection(dto, Objects.toString(exception.getMessage(), "Boss 岗位入库或持久 AI 入队失败")));
                    log.warn("Boss Chrome岗位处理失败，jobId={}", dto == null ? "" : dto.getId(), exception);
                }
            }
        }
        if (!rejected.isEmpty()) {
            Map<String, Object> response = decorateChromeJobRejections(
                    decorateListCollectionResponse(
                            bossChromeJobsResponse(false, false, received, insertedOrUpdated, queued, skipped, insufficient, restored, autoDeliver, analyses),
                            listOnlyCollection, listCollected, collectionWarnings
                    ),
                    received,
                    rejected
            );
            response.put("message", "部分 Boss 岗位未完成入库、历史恢复或持久 AI 入队，请查看 rejected 明细后重试被拒绝项");
            return ResponseEntity.status(429).body(response);
        }
        if (listOnlyCollection) {
            sendBossProgress(profileId, JobProgressMessage.success(
                    "boss",
                    "Boss当前搜索结果页已入库 " + insertedOrUpdated + " 个岗位，其中LIST_COLLECTED "
                            + listCollected + " 个，恢复历史结果 " + restored + " 个，未进入AI分析"
            ));
        } else {
            sendBossProgress(profileId, JobProgressMessage.success("boss", "Boss Chrome岗位已提交后台AI队列：入库 " + insertedOrUpdated + " 个，入队 " + queued + " 个，恢复本档案已有分析 " + restored + " 个，信息不足 " + insufficient + " 个"));
        }
        return ResponseEntity.ok(decorateChromeJobRejections(
                decorateListCollectionResponse(
                        bossChromeJobsResponse(true, false, received, insertedOrUpdated, queued, skipped, insufficient, restored, autoDeliver, analyses),
                        listOnlyCollection, listCollected, collectionWarnings
                ),
                received,
                rejected
        ));
    }

    @PostMapping("/chrome/jobs/dedupe")
    public ResponseEntity<Map<String, Object>> dedupeChromeJobs(@RequestBody ChromeJobBatchRequest request) {
        ResponseEntity<Map<String, Object>> profileError = validateChromeProfile(request == null ? null : request.getProfileId());
        if (profileError != null) return profileError;
        List<ChromeJobDto> jobs = request == null || request.getJobs() == null ? List.of() : request.getJobs();
        List<Map<String, Object>> items = new ArrayList<>();
        int duplicateCount = 0;
        Long profileId = request.getProfileId();
        Map<Integer, BossJobDataEntity> existingJobs = bossService.findExistingChromeBossJobs(profileId, jobs, null);

        for (int index = 0; index < jobs.size(); index++) {
            ChromeJobDto dto = jobs.get(index);
            String id = firstNonBlank(dto == null ? null : dto.getId(), dto == null ? null : extractBossId(dto.getUrl()));
            String company = dto == null ? "" : Objects.toString(dto.getCompany(), "");
            String title = dto == null ? "" : Objects.toString(dto.getTitle(), "");
            BossJobDataEntity existing = existingJobs.get(index);
            boolean duplicate = existing != null;
            if (duplicate) duplicateCount++;
            String matchReason = duplicate
                    ? id != null && !id.isBlank() && id.equals(Objects.toString(existing.getEncryptId(), "")) ? "jobId" : "companyTitle"
                    : "";
            List<String> missingFields = existing == null ? List.of() : collectMissingAnalysisFields(existing);
            String existingStatus = existing == null ? "" : Objects.toString(existing.getDeliveryStatus(), "");
            String action = dedupeAction(existing, missingFields);
            String reason = dedupeReason(action, matchReason, existingStatus, missingFields);
            Map<String, Object> item = new HashMap<>();
            item.put("id", Objects.toString(id, ""));
            item.put("url", dto == null ? "" : Objects.toString(dto.getUrl(), ""));
            item.put("title", title);
            item.put("company", company);
            item.put("duplicate", duplicate);
            item.put("action", action);
            item.put("reason", reason);
            item.put("matchReason", matchReason);
            item.put("existingStatus", existingStatus);
            item.put("existingId", existing == null || existing.getId() == null ? 0L : existing.getId());
            item.put("missingFields", missingFields);
            items.add(item);
        }

        long enrichCount = items.stream().filter(item -> "ENRICH".equals(item.get("action"))).count();
        long skipCount = items.stream().filter(item -> "SKIP".equals(item.get("action"))).count();
        return ResponseEntity.ok(Map.of(
                "success", true,
                "items", items,
                "duplicateCount", duplicateCount,
                "newCount", Math.max(0, jobs.size() - duplicateCount),
                "enrichCount", enrichCount,
                "skipCount", skipCount
        ));
    }

    private String dedupeAction(BossJobDataEntity existing, List<String> missingFields) {
        if (existing == null) return "NEW";
        String status = Objects.toString(existing.getDeliveryStatus(), "");
        if (DeliveryStatus.LIST_COLLECTED.equals(status)
                || DeliveryStatus.COLLECTION_INSUFFICIENT.equals(status)
                || (!DeliveryStatus.AI_ANALYZING.equals(status) && !isFinalBossStatus(status))
                || (missingFields != null && !missingFields.isEmpty())) {
            return "ENRICH";
        }
        return "SKIP";
    }

    private String dedupeReason(String action, String matchReason, String existingStatus, List<String> missingFields) {
        if ("NEW".equals(action)) return "未发现历史岗位";
        String matchedBy = "jobId".equals(matchReason) ? "Boss岗位ID" : "公司与岗位名称";
        if ("ENRICH".equals(action)) {
            String missing = missingFields == null || missingFields.isEmpty() ? "详情信息" : String.join("、", missingFields);
            return "历史岗位按" + matchedBy + "匹配，但需要补全：" + missing;
        }
        return "历史岗位按" + matchedBy + "匹配，状态为" + firstNonBlank(existingStatus, "完整记录") + "，本次跳过";
    }

    @PostMapping("/chrome/stop")
    public ResponseEntity<Map<String, Object>> stopChromeBoss(@RequestBody(required = false) Map<String, Object> payload) {
        Long profileId = parseProfileId(payload == null ? null : payload.get("profileId"));
        ResponseEntity<Map<String, Object>> profileError = validateChromeProfile(profileId);
        if (profileError != null) return profileError;
        String runId = payload == null ? null : Objects.toString(payload.get("runId"), "");
        jobRunCoordinator.requestCancel(runId);
        sendBossProgress(profileId, JobProgressMessage.warning("boss", "Boss Chrome扫描停止请求已发送"));
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
                    "limit", Math.min(Math.max(limit, 1), JobKeywordCodec.MAX_SELECTED)
            ));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of(
                    "success", false,
                    "message", e.getMessage(),
                    "keywords", List.of()
            ));
        } catch (RuntimeException e) {
            log.warn("生成 Boss AI 关键词失败: {}", e.getMessage());
            return ResponseEntity.status(502).body(Map.of(
                    "success", false,
                    "message", e.getMessage() == null ? "AI 关键词生成失败" : e.getMessage(),
                    "keywords", List.of()
            ));
        }
    }

    /** POST - 启动Boss投递任务（前端使用的接口）*/
    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> startBoss() {
        return bossBackendScanDisabledResponse();
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
        status.put("platform", "boss");
        status.put("backendScanEnabled", false);
        status.put("chromeBridgeRequired", true);
        status.put("isLoggedIn", false);
        status.put("searchReady", false);
        status.put("message", BOSS_BACKEND_SCAN_DISABLED_MESSAGE);
        status.put("debugUrl", buildBossDebugUrl());
        return ResponseEntity.ok(status);
    }

    private ResponseEntity<Map<String, Object>> bossBackendScanDisabledResponse() {
        return ResponseEntity.status(410).body(Map.of(
                "success", false,
                "platform", "boss",
                "status", "backend_scan_disabled",
                "message", BOSS_BACKEND_SCAN_DISABLED_MESSAGE
        ));
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
        if (!isBrowserDebugEnabled()) {
            return ResponseEntity.status(403).body(browserDebugError("browser_debug_disabled", "浏览器调试接口仅允许在本地开发模式使用"));
        }
        try {
            return ResponseEntity.ok(playwrightManager.getBossPageSnapshot());
        } catch (Exception e) {
            log.error("获取Boss浏览器截图失败", e);
            return ResponseEntity.internalServerError().body(browserDebugError("browser_snapshot_failed", "获取浏览器截图失败，请查看后端日志"));
        }
    }

    @PostMapping("/browser-click")
    public ResponseEntity<Map<String, Object>> clickBossBrowser(@RequestBody BrowserClickRequest request) {
        if (!isBrowserDebugEnabled()) {
            return ResponseEntity.status(403).body(browserDebugError("browser_debug_disabled", "浏览器调试接口仅允许在本地开发模式使用"));
        }
        String validationError = validateCoordinate("x", request == null ? null : request.getX());
        if (validationError == null) validationError = validateCoordinate("y", request == null ? null : request.getY());
        if (validationError != null) {
            return ResponseEntity.badRequest().body(browserDebugError("invalid_coordinate", validationError));
        }
        try {
            Map<String, Object> result = playwrightManager.clickBossPage(request.getX(), request.getY());
            return Boolean.TRUE.equals(result.get("success"))
                    ? ResponseEntity.ok(result)
                    : ResponseEntity.badRequest().body(toFriendlyBrowserResult(result));
        } catch (Exception e) {
            log.error("点击Boss浏览器页面失败", e);
            return ResponseEntity.internalServerError().body(browserDebugError("browser_click_failed", "点击浏览器页面失败，请查看后端日志"));
        }
    }

    @PostMapping("/browser-drag")
    public ResponseEntity<Map<String, Object>> dragBossBrowser(@RequestBody BrowserDragRequest request) {
        if (!isBrowserDebugEnabled()) {
            return ResponseEntity.status(403).body(browserDebugError("browser_debug_disabled", "浏览器调试接口仅允许在本地开发模式使用"));
        }
        String validationError = validateCoordinate("fromX", request == null ? null : request.getFromX());
        if (validationError == null) validationError = validateCoordinate("fromY", request == null ? null : request.getFromY());
        if (validationError == null) validationError = validateCoordinate("toX", request == null ? null : request.getToX());
        if (validationError == null) validationError = validateCoordinate("toY", request == null ? null : request.getToY());
        if (validationError != null) {
            return ResponseEntity.badRequest().body(browserDebugError("invalid_coordinate", validationError));
        }
        try {
            Map<String, Object> result = playwrightManager.dragBossPage(request.getFromX(), request.getFromY(), request.getToX(), request.getToY());
            return Boolean.TRUE.equals(result.get("success"))
                    ? ResponseEntity.ok(result)
                    : ResponseEntity.badRequest().body(toFriendlyBrowserResult(result));
        } catch (Exception e) {
            log.error("拖动Boss浏览器页面失败", e);
            return ResponseEntity.internalServerError().body(browserDebugError("browser_drag_failed", "拖动浏览器页面失败，请查看后端日志"));
        }
    }

    private boolean isBrowserDebugEnabled() {
        return environment.acceptsProfiles(Profiles.of("dev", "local"));
    }

    private String validateCoordinate(String field, Double value) {
        if (value == null) return field + " 坐标不能为空";
        if (!Double.isFinite(value)) return field + " 坐标必须是有效数字";
        if (value < 0 || value > MAX_BROWSER_COORDINATE) {
            return field + " 坐标必须在 0 到 " + (int) MAX_BROWSER_COORDINATE + " 之间";
        }
        return null;
    }

    private Map<String, Object> browserDebugError(String code, String message) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("code", code);
        response.put("message", message);
        return response;
    }

    private Map<String, Object> toFriendlyBrowserResult(Map<String, Object> result) {
        Map<String, Object> response = new HashMap<>();
        response.put("success", false);
        response.put("message", Objects.toString(result == null ? null : result.get("message"), "浏览器调试操作失败，请查看后端日志"));
        return response;
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

    private BossJobDataEntity toBossEntity(ChromeJobDto dto, String batchKeyword) {
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
        entity.setSourceKeyword(firstNonBlank(dto.getKeyword(), batchKeyword));
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
        // JD 定制话术必须同时具备岗位、公司和可用的岗位描述。
        boolean hasTitle = !isBlank(job.getJobName());
        boolean hasCompany = !isBlank(job.getCompanyName());
        if (!hasTitle) missing.add("岗位名称");
        if (!hasCompany) missing.add("公司名称");
        // 沿用岗位链接完整性检查，避免生成无法回到真实详情页的任务。
        if (isBlank(job.getJobUrl())) missing.add("岗位链接");
        String jobDescription = job.getJobDescription();
        if (isBlank(jobDescription) || jobDescription.trim().length() < 20) {
            missing.add("岗位JD");
        }
        return missing;
    }

    private List<String> collectMissingListFields(ChromeJobDto dto, BossJobDataEntity job, String batchKeyword) {
        List<String> missing = new ArrayList<>();
        if (job == null || isBlank(job.getJobName())) missing.add("title");
        if (job == null || isBlank(job.getCompanyName())) missing.add("company");
        if (job == null || isBlank(job.getSalary())) missing.add("salary");
        if (job == null || isBlank(job.getLocation())) missing.add("location");
        if (job == null || isBlank(job.getJobUrl())) missing.add("url");
        String keyword = dto == null ? null : dto.getKeyword();
        if (isBlank(firstNonBlank(keyword, batchKeyword))) missing.add("keyword");
        return missing;
    }

    private boolean isListOnlyCollection(ChromeJobBatchRequest request) {
        return request != null
                && "LIST_ONLY".equalsIgnoreCase(Objects.toString(request.getCollectionMode(), "").trim());
    }

    private boolean isHistoricalReuse(ChromeJobDto dto) {
        String action = Objects.toString(dto == null ? null : dto.getCollectionAction(), "").trim().toUpperCase();
        if (action.isEmpty() || "ANALYZE".equals(action)) return false;
        if ("REUSE_HISTORY".equals(action)) return true;
        throw new IllegalArgumentException("不支持的 Boss 岗位采集动作：" + action);
    }

    private BossJobDataEntity restoreHistoricalBossJob(Long profileId, ChromeJobDto dto, String runId) {
        if (profileId == null) throw new IllegalStateException("当前档案不可用，无法恢复历史岗位");
        if (runId == null || runId.isBlank()) throw new IllegalArgumentException("历史岗位恢复缺少本次 runId");
        String requestedId = firstNonBlank(dto == null ? null : dto.getId(), dto == null ? null : extractBossId(dto.getUrl()));
        if (requestedId == null || requestedId.isBlank()) {
            throw new IllegalArgumentException("历史岗位恢复缺少可核验的 Boss 岗位 ID");
        }
        Map<Integer, BossJobDataEntity> matches = bossService.findExistingChromeBossJobs(profileId, List.of(dto), null);
        BossJobDataEntity existing = matches.get(0);
        if (existing == null) throw new IllegalArgumentException("历史岗位身份核验失败，未找到当前档案中的匹配记录");
        if (!requestedId.equals(Objects.toString(existing.getEncryptId(), ""))) {
            throw new IllegalArgumentException("历史岗位身份核验失败，Boss 岗位 ID 不匹配");
        }
        List<String> missingFields = collectMissingAnalysisFields(existing);
        String action = dedupeAction(existing, missingFields);
        if (!"SKIP".equals(action)) {
            throw new IllegalStateException("历史岗位状态已变化，需要重新采集详情，当前动作：" + action);
        }
        BossJobDataEntity restored = bossService.reuseHistoricalBossJob(existing.getId(), profileId, runId);
        if (restored == null) throw new IllegalStateException("历史岗位恢复失败，记录可能已被其他操作修改");
        return restored;
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

    private Map<String, Object> decorateListCollectionResponse(Map<String, Object> response,
                                                               boolean listOnlyCollection,
                                                               int listCollected,
                                                               List<Map<String, Object>> collectionWarnings) {
        if (!listOnlyCollection) return response;
        response.put("asyncAnalysis", false);
        response.put("collectionMode", "LIST_ONLY");
        response.put("listCollected", listCollected);
        response.put("collectionWarnings", collectionWarnings == null ? List.of() : collectionWarnings);
        return response;
    }

    private Map<String, Object> decorateChromeJobRejections(Map<String, Object> response,
                                                              int requestedCount,
                                                              List<Map<String, Object>> rejected) {
        List<Map<String, Object>> safeRejected = rejected == null ? List.of() : rejected;
        int rejectedCount = safeRejected.size();
        int acceptedCount = Math.max(0, requestedCount - rejectedCount);
        response.put("status", rejectedCount == 0 ? "SUCCESS" : acceptedCount > 0 ? "PARTIAL" : "FAILED");
        response.put("requestedCount", requestedCount);
        response.put("acceptedCount", acceptedCount);
        response.put("rejectedCount", rejectedCount);
        response.put("rejected", safeRejected);
        return response;
    }

    private Map<String, Object> chromeJobRejection(ChromeJobDto dto, String message) {
        return Map.of(
                "jobId", Objects.toString(dto == null ? null : dto.getId(), ""),
                "message", firstNonBlank(message, "Boss 岗位处理失败")
        );
    }

    private String normalizeRunId(String runId) {
        return runId == null || runId.isBlank() ? null : runId.trim();
    }

    private ResponseEntity<Map<String, Object>> validateChromeProfile(Long requestedProfileId) {
        if (requestedProfileId == null || requestedProfileId <= 0) {
            return chromeProfileError(HttpStatus.BAD_REQUEST, "PROFILE_REQUIRED", "Chrome 扫描请求缺少有效档案 ID", null);
        }
        Long currentProfileId = profileService.getCurrentProfileIdOrNull();
        if (!Objects.equals(requestedProfileId, currentProfileId)) {
            return chromeProfileError(HttpStatus.CONFLICT, "PROFILE_CHANGED", "当前档案已切换，旧扫描已停止；请重新加载扩展后从当前档案重新扫描", currentProfileId);
        }
        return null;
    }

    private ResponseEntity<Map<String, Object>> chromeProfileError(HttpStatus status,
                                                                    String errorCode,
                                                                    String message,
                                                                    Long currentProfileId) {
        Map<String, Object> body = new HashMap<>();
        body.put("success", false);
        body.put("errorCode", errorCode);
        body.put("message", message);
        if (currentProfileId != null) body.put("currentProfileId", currentProfileId);
        return ResponseEntity.status(status).body(body);
    }

    private Long parseProfileId(Object value) {
        if (value instanceof Number number) return number.longValue();
        try {
            String text = Objects.toString(value, "").trim();
            return text.isEmpty() ? null : Long.parseLong(text);
        } catch (NumberFormatException ignored) {
            return null;
        }
    }

    private void validateBossSavedIdentity(Long profileId, ChromeJobDto dto, BossJobDataEntity saved) {
        if (saved.getId() == null || !Objects.equals(profileId, saved.getProfileId())) {
            throw new IllegalStateException("Boss 岗位入库结果与扫描档案不一致");
        }
        String requestedJobId = firstNonBlank(dto == null ? null : dto.getId(), dto == null ? null : extractBossId(dto.getUrl()));
        if (requestedJobId != null
                && !requestedJobId.isBlank()
                && !requestedJobId.trim().equals(Objects.toString(saved.getEncryptId(), "").trim())) {
            throw new IllegalStateException("Boss 岗位稳定 ID 与入库记录不一致，已阻止错误分析任务");
        }
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
        item.put("scanResultSource", Objects.toString(job.getScanResultSource(), ""));
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

    private void sendBossProgress(Long profileId, JobProgressMessage message) {
        if (message != null) message.setProfileId(profileId);
        sendBossProgress(message);
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
