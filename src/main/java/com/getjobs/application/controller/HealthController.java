package com.getjobs.application.controller;

import com.getjobs.worker.manager.PlaywrightManager;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.HashMap;
import java.util.Map;

/**
 * 系统健康检查控制器
 */
@RestController
@RequestMapping("/api")
@RequiredArgsConstructor
public class HealthController {
    private final PlaywrightManager playwrightManager;

    /**
     * 健康检查接口
     * @return 健康状态
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        Map<String, Object> response = new HashMap<>();
        boolean browserInitialized = playwrightManager.isInitialized();
        boolean browserInitializing = playwrightManager.isInitializing();
        String initializationError = playwrightManager.getLastInitializationError();
        boolean browserFailed = !browserInitialized
                && !browserInitializing
                && initializationError != null
                && !initializationError.isBlank();
        Map<String, Object> browserAutomation = new HashMap<>();
        browserAutomation.put("available", !browserFailed);
        browserAutomation.put("initialized", browserInitialized);
        browserAutomation.put("initializing", browserInitializing);
        browserAutomation.put("message", browserMessage(
                browserInitialized,
                browserInitializing,
                initializationError
        ));

        response.put("status", browserFailed ? "DEGRADED" : "UP");
        response.put("timestamp", System.currentTimeMillis());
        response.put("service", "GetJobs");
        response.put("browserAutomation", browserAutomation);
        return ResponseEntity.ok(response);
    }

    private String browserMessage(boolean initialized, boolean initializing, String initializationError) {
        if (initialized) {
            return "浏览器自动化运行正常";
        }
        if (initializing) {
            return "浏览器自动化正在初始化";
        }
        if (initializationError != null && !initializationError.isBlank()) {
            return initializationError;
        }
        return "浏览器自动化尚未启动，将在使用招聘平台功能时按需初始化";
    }
}
