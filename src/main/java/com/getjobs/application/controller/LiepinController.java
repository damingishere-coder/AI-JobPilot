package com.getjobs.application.controller;

import com.getjobs.application.entity.CookieEntity;
import com.getjobs.application.controller.support.CookieResponseView;
import com.getjobs.application.entity.LiepinConfigEntity;
import com.getjobs.application.entity.LiepinOptionEntity;
import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.DeliveryAttemptService;
import com.getjobs.application.service.LiepinService;
import com.getjobs.worker.manager.PlaywrightManager;
import com.getjobs.worker.dto.JobProgressMessage;
import com.getjobs.worker.service.LiepinJobService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.Executor;

/**
 * 猎聘控制器
 * 提供猎聘自动投递功能的REST API接口
 */
@RestController
@RequestMapping("/api/liepin")
public class LiepinController {

    private static final Logger log = LoggerFactory.getLogger(LiepinController.class);

    @Autowired
    private LiepinJobService liepinJobService;

    @Autowired
    private PlaywrightManager playwrightManager;

    @Autowired
    private CookieService cookieService;

    @Autowired
    private LiepinService liepinService;

    @Autowired
    private DeliveryAttemptService deliveryAttemptService;

    @Autowired
    @Qualifier("jobTaskExecutor")
    private Executor jobTaskExecutor;

    /**
     * 检查登录状态
     * @return 登录状态信息
     */
    @GetMapping("/login-status")
    public ResponseEntity<Map<String, Object>> checkLoginStatus() {
        Map<String, Object> response = new HashMap<>();

        try {
            boolean isLoggedIn = playwrightManager.isLoggedIn("liepin");
            response.put("success", true);
            response.put("isLoggedIn", isLoggedIn);
            response.put("message", isLoggedIn ? "已登录" : "未登录");

            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("检查猎聘登录状态失败", e);
            response.put("success", false);
            response.put("message", "检查登录状态失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 启动猎聘自动投递任务
     * @return 响应结果
     */
    @PostMapping("/start")
    public ResponseEntity<Map<String, Object>> startLiepinJob(
            @RequestBody(required = false) Map<String, Object> request,
            @RequestHeader(value = "X-Real-Delivery-Confirmation", required = false) String deliveryConfirmation) {
        Map<String, Object> response = new HashMap<>();

        try {
            boolean deliveryMode = request != null && "delivery".equalsIgnoreCase(Objects.toString(request.get("mode"), ""));
            if (deliveryMode && !"CONFIRM_REAL_DELIVERY".equals(deliveryConfirmation)) {
                response.put("success", false);
                response.put("message", "真实投递模式需要操作当时再次确认；未提供有效确认头");
                response.put("status", "confirmation_required");
                return ResponseEntity.badRequest().body(response);
            }
            // 未登录则不允许启动
            if (!playwrightManager.isLoggedIn("liepin")) {
                response.put("success", false);
                response.put("message", "请先登录猎聘");
                response.put("status", "not_logged_in");
                return ResponseEntity.badRequest().body(response);
            }

            // 检查是否已有任务在运行
            if (liepinJobService.isRunning()) {
                response.put("success", false);
                response.put("message", "猎聘任务已在运行中，请等待当前任务完成");
                response.put("status", "running");
                return ResponseEntity.badRequest().body(response);
            }

            // 异步启动新任务
            CompletableFuture.runAsync(() -> {
                try {
                    java.util.function.Consumer<JobProgressMessage> progress = progressMessage -> {
                        log.info("[{}] {}", progressMessage.getPlatform(), progressMessage.getMessage());
                    };
                    if (deliveryMode) liepinJobService.executeDelivery(progress);
                    else liepinJobService.executeCollection(progress);
                } catch (Exception e) {
                    log.error("猎聘异步任务执行失败", e);
                    log.warn("猎聘任务执行失败，请查看后端日志");
                }
            }, jobTaskExecutor);

            response.put("success", true);
            response.put("message", deliveryMode ? "猎聘投递任务启动成功" : "猎聘只读采集任务启动成功，不会执行真实投递");
            response.put("status", "started");
            response.put("mode", deliveryMode ? "delivery" : "collection");

            log.info("通过API启动猎聘任务成功");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("启动猎聘任务失败", e);
            response.put("success", false);
            response.put("message", "启动猎聘任务失败: " + e.getMessage());
            response.put("error", e.getClass().getSimpleName());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 停止猎聘任务
     * @return 响应结果
     */
    @PostMapping("/stop")
    public ResponseEntity<Map<String, Object>> stopLiepinJob() {
        Map<String, Object> response = new HashMap<>();

        try {
            if (!liepinJobService.isRunning()) {
                response.put("success", false);
                response.put("message", "没有正在运行的猎聘任务");
                return ResponseEntity.badRequest().body(response);
            }

            liepinJobService.stopDelivery();

            response.put("success", true);
            response.put("message", "猎聘任务停止请求已发送");

            log.info("通过API停止猎聘任务");
            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("停止猎聘任务失败", e);
            response.put("success", false);
            response.put("message", "停止猎聘任务失败: " + e.getMessage());
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
            Map<String, Object> status = liepinJobService.getStatus();
            response.put("success", true);
            response.putAll(status);
            response.put("timestamp", System.currentTimeMillis());

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取猎聘当前状态失败", e);
            response.put("success", false);
            response.put("message", "获取状态失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 健康检查接口
     * @return 服务状态
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("service", "LiepinController");
        response.put("status", "healthy");
        response.put("timestamp", System.currentTimeMillis());

        return ResponseEntity.ok(response);
    }

    // ==================== 配置管理（合并） ====================

    /** 获取所有猎聘配置信息（包括选项） */
    @GetMapping("/config")
    public Map<String, Object> getAllLiepinConfig() {
        Map<String, Object> result = new HashMap<>();
        LiepinConfigEntity config = liepinService.getFirstConfig();
        if (config == null) config = new LiepinConfigEntity();
        Map<String, java.util.List<LiepinOptionEntity>> options = new HashMap<>();
        options.put("city", liepinService.getOptionsByType("city"));
        result.put("config", config);
        result.put("options", options);
        return result;
    }

    /** 更新猎聘配置 */
    @PutMapping("/config")
    public LiepinConfigEntity updateConfig(@RequestBody LiepinConfigEntity config) {
        if (config.getCity() != null && !config.getCity().isEmpty()) {
            String cityName = liepinService.normalizeCityToName(config.getCity());
            config.setCity(cityName);
        }
        if (config.getId() != null) {
            return liepinService.updateConfig(config);
        }
        return liepinService.saveOrUpdateFirstSelective(config);
    }

    /** 获取指定类型的选项列表 */
    @GetMapping("/config/options/{type}")
    public java.util.List<LiepinOptionEntity> getOptionsByType(@PathVariable String type) {
        return liepinService.getOptionsByType(type);
    }

    // ==================== 投递分析（合并） ====================

    /** 投递分析统计与图表 */
    @GetMapping("/stats")
    public LiepinService.StatsResponse getStats(
            @RequestParam(value = "statuses", required = false) String statuses,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "experience", required = false) String experience,
            @RequestParam(value = "degree", required = false) String degree,
            @RequestParam(value = "minK", required = false) Double minK,
            @RequestParam(value = "maxK", required = false) Double maxK,
            @RequestParam(value = "keyword", required = false) String keyword
    ) {
        java.util.List<String> statusList = null;
        if (statuses != null && !statuses.trim().isEmpty()) {
            statusList = java.util.Arrays.stream(statuses.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(java.util.stream.Collectors.toList());
        }
        return liepinService.getLiepinStats(statusList, location, experience, degree, minK, maxK, keyword);
    }

    /** 岗位列表（分页 + 筛选） */
    @GetMapping("/list")
    public LiepinService.PagedResult list(
            @RequestParam(value = "statuses", required = false) String statuses,
            @RequestParam(value = "location", required = false) String location,
            @RequestParam(value = "experience", required = false) String experience,
            @RequestParam(value = "degree", required = false) String degree,
            @RequestParam(value = "minK", required = false) Double minK,
            @RequestParam(value = "maxK", required = false) Double maxK,
            @RequestParam(value = "keyword", required = false) String keyword,
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
        return liepinService.listLiepinJobs(statusList, location, experience, degree, minK, maxK, keyword, page, size);
    }

    @PostMapping("/jobs/{jobId}/delivery-reconcile")
    public Map<String, Object> reconcileDelivery(@PathVariable("jobId") Long jobId,
                                                 @RequestBody DeliveryResultRequest request) {
        DeliveryAttemptService.State target = request == null
                ? null
                : DeliveryAttemptService.State.parse(request.getOutcome());
        DeliveryAttemptService.ResolutionResult result = deliveryAttemptService.reconcileLatestLegacy(
                "liepin", jobId, target, request == null ? null : request.getMessage());
        return Map.of(
                "success", result.accepted(),
                "idempotent", result.idempotent(),
                "message", result.message(),
                "state", result.state() == null ? "" : result.state().name()
        );
    }

    @PostMapping("/jobs/{jobId}/delivery-retry")
    public Map<String, Object> prepareDeliveryRetry(@PathVariable("jobId") Long jobId) {
        DeliveryAttemptService.RequestResult result = deliveryAttemptService.prepareLegacyRetry("liepin", jobId);
        return Map.of(
                "success", result.accepted(),
                "prepared", result.accepted(),
                "message", result.message()
        );
    }

    /**
     * 调试接口：读取数据库中的猎聘 Cookie 记录
     */
    @GetMapping("/cookie")
    public ResponseEntity<Map<String, Object>> getLiepinCookieRecord() {
        Map<String, Object> response = new HashMap<>();
        try {
            CookieEntity cookie = cookieService.getCookieByPlatform("liepin");
            Map<String, Object> data = CookieResponseView.from(cookie, "liepin", "未找到猎聘Cookie记录");
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
     * 退出登录：清空数据库Cookie并清理运行中的上下文Cookie
     */
    @PostMapping("/logout")
    public ResponseEntity<Map<String, Object>> logoutLiepin() {
        Map<String, Object> response = new HashMap<>();
        try {
            // 更新登录状态为未登录并触发SSE通知
            playwrightManager.setLoginStatus("liepin", false);

            // 清空数据库中猎聘平台的所有 Cookie 值
            cookieService.clearCookieByPlatform("liepin", "manual logout");

            // 清理运行中的上下文Cookie
            try {
                playwrightManager.clearLiepinCookies();
            } catch (Exception e) {
                log.warn("清理猎聘上下文Cookie时发生异常，但不影响退出流程: {}", e.getMessage());
            }

            response.put("success", true);
            response.put("message", "猎聘已退出登录，数据库Cookie和上下文Cookie均已清理");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("猎聘退出登录失败", e);
            response.put("success", false);
            response.put("message", "退出登录失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 调试接口：主动保存当前上下文中的猎聘 Cookie 到数据库
     */
    @PostMapping("/save-cookie")
    public ResponseEntity<Map<String, Object>> saveLiepinCookie() {
        Map<String, Object> response = new HashMap<>();
        try {
            playwrightManager.saveLiepinCookiesToDb("manual save");
            response.put("success", true);
            response.put("message", "已主动保存猎聘Cookie到数据库");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            response.put("success", false);
            response.put("message", "保存猎聘Cookie失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }
}
