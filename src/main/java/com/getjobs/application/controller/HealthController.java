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
        boolean browserAvailable = playwrightManager.isInitialized();
        Map<String, Object> browserAutomation = new HashMap<>();
        browserAutomation.put("available", browserAvailable);
        browserAutomation.put("initialized", browserAvailable);
        browserAutomation.put("initializing", playwrightManager.isInitializing());
        browserAutomation.put("message", browserAvailable
                ? "浏览器自动化运行正常"
                : firstNonBlank(playwrightManager.getLastInitializationError(), "浏览器自动化暂不可用"));

        response.put("status", browserAvailable ? "UP" : "DEGRADED");
        response.put("timestamp", System.currentTimeMillis());
        response.put("service", "GetJobs");
        response.put("browserAutomation", browserAutomation);
        return ResponseEntity.ok(response);
    }

    private String firstNonBlank(String value, String fallback) {
        return value == null || value.isBlank() ? fallback : value;
    }
}
