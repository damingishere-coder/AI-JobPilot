package com.getjobs.application.controller;

import com.getjobs.application.service.ConfigService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.Map;

/**
 * 配置控制器
 * 提供配置管理的REST API接口
 */
@Slf4j
@RestController
@RequestMapping("/api/config")
@RequiredArgsConstructor
public class ConfigController {
    private final ConfigService configService;

    /**
     * 获取所有配置
     * @return 配置Map
     */
    @GetMapping
    public ResponseEntity<Map<String, Object>> getAllConfigs() {
        Map<String, Object> response = new HashMap<>();

        try {
            Map<String, Object> configs = configService.getUiConfigsAsMap();

            response.put("success", true);
            response.put("data", configs);
            response.put("sensitive", configService.getSensitiveUiConfigStatus());
            response.put("message", "获取配置成功");

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取配置失败", e);
            response.put("success", false);
            response.put("message", "获取配置失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 根据配置键获取单个配置
     * @param key 配置键
     * @return 配置值
     */
    @GetMapping("/{key}")
    public ResponseEntity<Map<String, Object>> getConfigByKey(@PathVariable String key) {
        Map<String, Object> response = new HashMap<>();

        try {
            if (!configService.isUiConfigKeyAllowed(key)) {
                throw new IllegalArgumentException("不允许读取该配置键: " + key);
            }
            var config = configService.getConfigByKey(key);

            if (config != null || configService.isSensitiveUiConfigKey(key)) {
                Map<String, Object> data = new HashMap<>();
                data.put("config_key", key.toUpperCase());
                if (configService.isSensitiveUiConfigKey(key)) {
                    data.put("config_value", null);
                    data.put("sensitive", true);
                    data.put("configured", configService.isSensitiveUiConfigConfigured(key));
                } else {
                    data.put("config_value", config.getConfigValue());
                    data.put("sensitive", false);
                    data.put("configured", config.getConfigValue() != null && !config.getConfigValue().isBlank());
                }
                response.put("success", true);
                response.put("data", data);
                response.put("message", "获取配置成功");
                return ResponseEntity.ok(response);
            } else {
                response.put("success", false);
                response.put("message", "配置不存在");
                return ResponseEntity.notFound().build();
            }

        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("获取配置失败: {}", key, e);
            response.put("success", false);
            response.put("message", "获取配置失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 批量更新配置
     * @param configMap 配置Map，key为config_key，value为config_value
     * @return 更新结果
     */
    @PostMapping
    public ResponseEntity<Map<String, Object>> batchUpdateConfigs(@RequestBody Map<String, String> configMap) {
        Map<String, Object> response = new HashMap<>();

        try {
            if (configMap == null || configMap.isEmpty()) {
                response.put("success", false);
                response.put("message", "配置数据不能为空");
                return ResponseEntity.badRequest().body(response);
            }

            int updateCount = configService.batchUpdateConfigs(configMap);

            response.put("success", true);
            response.put("message", "配置更新成功");
            response.put("updateCount", updateCount);

            log.info("批量更新配置成功，共更新 {} 项", updateCount);
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("批量更新配置失败", e);
            response.put("success", false);
            response.put("message", "配置更新失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 更新单个配置
     * @param key 配置键
     * @param requestBody 请求体包含value
     * @return 更新结果
     */
    @PutMapping("/{key}")
    public ResponseEntity<Map<String, Object>> updateConfig(
            @PathVariable String key,
            @RequestBody Map<String, String> requestBody) {

        Map<String, Object> response = new HashMap<>();

        try {
            String value = requestBody.get("value");

            if (value == null) {
                response.put("success", false);
                response.put("message", "配置值不能为空");
                return ResponseEntity.badRequest().body(response);
            }

            boolean success = configService.updateConfig(key, value);

            if (success) {
                response.put("success", true);
                response.put("message", "配置更新成功");
                return ResponseEntity.ok(response);
            } else {
                response.put("success", false);
                response.put("message", "配置更新失败，配置键可能不存在");
                return ResponseEntity.badRequest().body(response);
            }

        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("更新配置失败: {}", key, e);
            response.put("success", false);
            response.put("message", "配置更新失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 显式清除敏感配置。普通空字符串更新会保留原值，避免遮罩页面误覆盖。
     */
    @DeleteMapping("/{key}")
    public ResponseEntity<Map<String, Object>> clearSensitiveConfig(@PathVariable String key) {
        Map<String, Object> response = new HashMap<>();
        try {
            boolean success = configService.clearSensitiveUiConfig(key);
            response.put("success", success);
            boolean configured = success && configService.isSensitiveUiConfigConfigured(key);
            response.put("configured", configured);
            response.put("message", success
                    ? (configured ? "数据库值已清除，但同名环境变量仍在生效" : "敏感配置已清除")
                    : "敏感配置清除失败");
            return success ? ResponseEntity.ok(response) : ResponseEntity.internalServerError().body(response);
        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("清除敏感配置失败: {}", key, e);
            response.put("success", false);
            response.put("message", "敏感配置清除失败: " + e.getMessage());
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
        response.put("service", "ConfigController");
        response.put("status", "healthy");
        response.put("timestamp", System.currentTimeMillis());

        return ResponseEntity.ok(response);
    }
}
