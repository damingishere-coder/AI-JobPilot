package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.getjobs.application.entity.ConfigEntity;
import com.getjobs.application.mapper.ConfigMapper;
import com.getjobs.application.entity.LiepinConfigEntity;
import com.getjobs.application.service.LiepinService;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.application.service.Job51Service;
import com.getjobs.worker.boss.BossConfig;
import com.getjobs.worker.job51.Job51Config;
import com.getjobs.worker.liepin.LiepinConfig;
import com.getjobs.worker.zhilian.ZhilianConfig;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * 配置服务类
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class ConfigService {
    private static final Set<String> UI_CONFIG_KEYS = Set.of(
            "AI_PROVIDER",
            "BASE_URL",
            "API_KEY",
            "MODEL",
            "CODEX_PATH",
            "CODEX_MODEL",
            "CODEX_TIMEOUT_SECONDS",
            "HOOK_URL",
            "BOT_IS_SEND"
    );
    private static final Set<String> SENSITIVE_UI_CONFIG_KEYS = Set.of("API_KEY", "HOOK_URL");

    private final ConfigMapper configMapper;
    private final LiepinService liepinService;
    private final BossService bossService;
    private final ZhilianService zhilianService;
    private final Job51Service job51Service;
    private final Environment environment;
    private final CodexCliService codexCliService;

    /**
     * 获取所有配置（以Map形式返回）
     * @return 配置Map，key为config_key，value为config_value
     */
    public Map<String, String> getAllConfigsAsMap() {
        List<ConfigEntity> configs = configMapper.selectList(null);
        Map<String, String> configMap = new HashMap<>();

        for (ConfigEntity config : configs) {
            configMap.put(config.getConfigKey(), config.getConfigValue());
        }

        return configMap;
    }

    /**
     * 获取可安全返回给环境配置页面的配置。敏感值只保留键，不返回原文。
     */
    public Map<String, Object> getUiConfigsAsMap() {
        List<ConfigEntity> configs = configMapper.selectList(null);
        Map<String, Object> configMap = new LinkedHashMap<>();
        for (String sensitiveKey : SENSITIVE_UI_CONFIG_KEYS) {
            configMap.put(sensitiveKey, null);
        }
        for (ConfigEntity config : configs) {
            String key = normalizeUiConfigKey(config.getConfigKey());
            if (UI_CONFIG_KEYS.contains(key) && !SENSITIVE_UI_CONFIG_KEYS.contains(key)) {
                configMap.put(key, config.getConfigValue());
            }
        }
        return configMap;
    }

    /**
     * 仅返回敏感配置是否存在，不返回配置原值。
     */
    public Map<String, Boolean> getSensitiveUiConfigStatus() {
        Map<String, Boolean> status = new LinkedHashMap<>();
        for (String key : SENSITIVE_UI_CONFIG_KEYS) {
            status.put(key, isSensitiveUiConfigConfigured(key));
        }
        return status;
    }

    public boolean isSensitiveUiConfigConfigured(String configKey) {
        String key = normalizeUiConfigKey(configKey);
        if (!SENSITIVE_UI_CONFIG_KEYS.contains(key)) {
            throw new IllegalArgumentException("不是可管理的敏感配置键: " + key);
        }
        String value = getConfigValue(key);
        if (value == null || value.isBlank()) {
            value = environment.getProperty(key);
        }
        return value != null && !value.isBlank();
    }

    public boolean isUiConfigKeyAllowed(String configKey) {
        return UI_CONFIG_KEYS.contains(normalizeUiConfigKey(configKey));
    }

    public boolean isSensitiveUiConfigKey(String configKey) {
        return SENSITIVE_UI_CONFIG_KEYS.contains(normalizeUiConfigKey(configKey));
    }

    /**
     * 获取所有配置
     * @return 配置列表
     */
    public List<ConfigEntity> getAllConfigs() {
        return configMapper.selectList(null);
    }

    /**
     * 根据配置键获取配置
     * @param configKey 配置键
     * @return 配置实体
     */
    public ConfigEntity getConfigByKey(String configKey) {
        LambdaQueryWrapper<ConfigEntity> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ConfigEntity::getConfigKey, configKey);
        return configMapper.selectOne(queryWrapper);
    }

    /**
     * 根据分类获取配置列表
     * @param category 分类
     * @return 配置列表
     */
    public List<ConfigEntity> getConfigsByCategory(String category) {
        LambdaQueryWrapper<ConfigEntity> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(ConfigEntity::getCategory, category);
        return configMapper.selectList(queryWrapper);
    }

    /**
     * 根据配置键获取配置值（可能为null）
     * @param configKey 配置键
     * @return 配置值或null
     */
    public String getConfigValue(String configKey) {
        ConfigEntity entity = getConfigByKey(configKey);
        return entity != null ? entity.getConfigValue() : null;
    }

    /**
     * 根据配置键获取必填配置值（缺失或空则抛异常）
     * @param configKey 配置键
     * @return 配置值（非空）
     * @throws IllegalStateException 当配置缺失或空白时抛出
     */
    public String requireConfigValue(String configKey) {
        String value = getConfigValue(configKey);
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少必要配置: " + configKey);
        }
        return value;
    }

    /**
     * 获取 AI 调用配置。默认使用本机 Codex CLI；选择 api 时才要求远程地址和密钥。
     */
    public Map<String, String> getAiConfigs() {
        Map<String, String> result = new HashMap<>();
        String provider = optionalAiConfigValue("AI_PROVIDER", "codex").toLowerCase();
        if (!"codex".equals(provider) && !"api".equals(provider) && !"remote".equals(provider)) {
            throw new IllegalStateException("AI_PROVIDER 只能是 codex 或 api");
        }
        result.put("AI_PROVIDER", "remote".equals(provider) ? "api" : provider);
        result.put("CODEX_PATH", optionalAiConfigValue("CODEX_PATH", "codex"));
        result.put("CODEX_HOME", optionalAiConfigValue("CODEX_HOME", ""));
        result.put("CODEX_MODEL", optionalAiConfigValue("CODEX_MODEL", "gpt-5.6-sol"));
        result.put("CODEX_TIMEOUT_SECONDS", optionalAiConfigValue("CODEX_TIMEOUT_SECONDS", "300"));
        if ("codex".equals(provider)) {
            result.put("BASE_URL", optionalAiConfigValue("BASE_URL", ""));
            result.put("API_KEY", optionalAiConfigValue("API_KEY", ""));
            result.put("MODEL", optionalAiConfigValue("MODEL", ""));
        } else {
            result.put("BASE_URL", requireAiConfigValue("BASE_URL"));
            result.put("API_KEY", requireAiConfigValue("API_KEY"));
            result.put("MODEL", requireAiConfigValue("MODEL"));
        }
        return result;
    }

    /**
     * 批量更新配置
     * @param configMap 配置Map，key为config_key，value为config_value
     * @return 更新的配置数量
     */
    @Transactional
    public int batchUpdateConfigs(Map<String, String> configMap) {
        if (configMap == null) {
            throw new IllegalArgumentException("配置数据不能为空");
        }
        for (Map.Entry<String, String> entry : configMap.entrySet()) {
            String key = validateUiConfigKey(entry.getKey());
            validateUiConfigValue(key, entry.getValue());
        }

        int updateCount = 0;

        for (Map.Entry<String, String> entry : configMap.entrySet()) {
            String key = normalizeUiConfigKey(entry.getKey());
            String value = entry.getValue();

            // 敏感输入为空代表页面没有提供新值，保留数据库中的现有值。
            if (SENSITIVE_UI_CONFIG_KEYS.contains(key) && (value == null || value.isBlank())) {
                continue;
            }

            ConfigEntity config = getConfigByKey(key);

            if (config != null) {
                config.setConfigValue(value);
                config.setUpdatedAt(LocalDateTime.now());
                configMapper.updateById(config);
                updateCount++;
                log.info("更新配置: {} = {}", key, displayConfigValue(key, value));
            } else {
                ConfigEntity created = new ConfigEntity();
                created.setConfigKey(key);
                created.setConfigValue(value);
                created.setConfigType("string");
                created.setCategory(resolveConfigCategory(key));
                created.setDescription(resolveConfigDescription(key));
                if (createConfig(created)) {
                    updateCount++;
                }
            }
        }

        return updateCount;
    }

    /**
     * 更新单个配置
     * @param configKey 配置键
     * @param configValue 配置值
     * @return 是否更新成功
     */
    @Transactional
    public boolean updateConfig(String configKey, String configValue) {
        String key = validateUiConfigKey(configKey);
        validateUiConfigValue(key, configValue);
        if (SENSITIVE_UI_CONFIG_KEYS.contains(key) && (configValue == null || configValue.isBlank())) {
            return true;
        }
        ConfigEntity config = getConfigByKey(key);

        if (config != null) {
            config.setConfigValue(configValue);
            config.setUpdatedAt(LocalDateTime.now());
            int result = configMapper.updateById(config);

            if (result > 0) {
                log.info("更新配置成功: {} = {}", key, displayConfigValue(key, configValue));
                return true;
            }
        } else {
            ConfigEntity created = new ConfigEntity();
            created.setConfigKey(key);
            created.setConfigValue(configValue);
            created.setConfigType("string");
            created.setCategory(resolveConfigCategory(key));
            created.setDescription(resolveConfigDescription(key));
            return createConfig(created);
        }

        return false;
    }

    /**
     * 显式清除可由 UI 管理的敏感配置。不存在时视为已经清除。
     */
    @Transactional
    public boolean clearSensitiveUiConfig(String configKey) {
        String key = normalizeUiConfigKey(configKey);
        if (!SENSITIVE_UI_CONFIG_KEYS.contains(key)) {
            throw new IllegalArgumentException("仅允许清除 API_KEY 或 HOOK_URL");
        }
        ConfigEntity config = getConfigByKey(key);
        if (config == null) {
            return true;
        }
        config.setConfigValue("");
        config.setUpdatedAt(LocalDateTime.now());
        int result = configMapper.updateById(config);
        if (result > 0) {
            log.info("已清除敏感配置: {}", key);
        }
        return result > 0;
    }

    /**
     * 创建新配置
     * @param config 配置实体
     * @return 是否创建成功
     */
    @Transactional
    public boolean createConfig(ConfigEntity config) {
        config.setCreatedAt(LocalDateTime.now());
        config.setUpdatedAt(LocalDateTime.now());

        int result = configMapper.insert(config);

        if (result > 0) {
            log.info("创建配置成功: {} = {}", config.getConfigKey(), displayConfigValue(config.getConfigKey(), config.getConfigValue()));
            return true;
        }

        return false;
    }

    private String requireAiConfigValue(String configKey) {
        String value = getConfigValue(configKey);
        if (value == null || value.isBlank()) {
            value = environment.getProperty(configKey);
        }
        if (value == null || value.isBlank()) {
            throw new IllegalStateException("缺少必要AI配置：" + configKey + "。请先在“环境配置”页面填写并保存 BASE_URL、API_KEY、MODEL。");
        }
        return value.trim();
    }

    private String optionalAiConfigValue(String configKey, String defaultValue) {
        String value = getConfigValue(configKey);
        if (value == null || value.isBlank()) {
            value = environment.getProperty(configKey);
        }
        return value == null || value.isBlank() ? defaultValue : value.trim();
    }

    private String validateUiConfigKey(String configKey) {
        String key = normalizeUiConfigKey(configKey);
        if (!UI_CONFIG_KEYS.contains(key)) {
            throw new IllegalArgumentException("不允许通过配置接口读写该配置键: " + key);
        }
        return key;
    }

    private void validateUiConfigValue(String configKey, String configValue) {
        if ("CODEX_PATH".equals(configKey)) {
            codexCliService.validateExecutableName(configValue);
        }
    }

    private String normalizeUiConfigKey(String configKey) {
        return configKey == null ? "" : configKey.trim().toUpperCase();
    }

    private String resolveConfigCategory(String configKey) {
        if (configKey == null) {
            return "general";
        }
        return switch (configKey) {
            case "AI_PROVIDER", "BASE_URL", "API_KEY", "MODEL", "CODEX_PATH", "CODEX_HOME", "CODEX_MODEL", "CODEX_TIMEOUT_SECONDS" -> "ai";
            case "HOOK_URL", "BOT_IS_SEND" -> "notification";
            default -> "general";
        };
    }

    private String resolveConfigDescription(String configKey) {
        if (configKey == null) {
            return "运行配置";
        }
        return switch (configKey) {
            case "AI_PROVIDER" -> "AI 调用方式（Codex CLI 或远程 API）";
            case "BASE_URL" -> "AI 服务地址";
            case "API_KEY" -> "AI 服务密钥";
            case "MODEL" -> "AI 模型名称";
            case "CODEX_PATH" -> "Codex CLI 可执行文件";
            case "CODEX_HOME" -> "Codex 登录配置目录";
            case "CODEX_MODEL" -> "Codex 模型名称";
            case "CODEX_TIMEOUT_SECONDS" -> "Codex 单任务超时秒数";
            case "HOOK_URL" -> "企业微信 Webhook 地址";
            case "BOT_IS_SEND" -> "企业微信通知发送开关";
            default -> "运行配置";
        };
    }

    private String displayConfigValue(String configKey, String configValue) {
        if (isSensitiveConfig(configKey)) {
            return configValue == null || configValue.isBlank() ? "" : "[已隐藏]";
        }
        return configValue;
    }

    private boolean isSensitiveConfig(String configKey) {
        if (configKey == null) {
            return false;
        }
        String key = configKey.toUpperCase();
        return key.contains("KEY")
                || key.contains("TOKEN")
                || key.contains("SECRET")
                || key.contains("PASSWORD")
                || key.contains("COOKIE")
                || "HOOK_URL".equals(key);
    }

    /**
     * 统一入口：从专表 liepin_config 读取并构建 LiepinConfig
     * 说明：每个平台维持专表，由 ConfigService 暴露统一读取方法供 Worker 使用。
     */
    public LiepinConfig getLiepinConfig() {
        LiepinConfigEntity entity = liepinService.getFirstConfig();

        LiepinConfig config = new LiepinConfig();

        // 关键词解析：支持逗号、中文逗号、或 [a,b] 格式
        java.util.List<String> keywords = new java.util.ArrayList<>();
        if (entity != null && entity.getKeywords() != null) {
            String raw = entity.getKeywords().trim();
            raw = raw.replace('，', ',');
            if (raw.startsWith("[") && raw.endsWith("]")) {
                raw = raw.substring(1, raw.length() - 1);
            }
            for (String s : raw.split(",")) {
                String t = s.trim();
                if (!t.isEmpty()) keywords.add(t);
            }
        }
        config.setKeywords(keywords);

        // 城市编码：允许传中文名或代码；中文名映射为代码；缺省视为不限
        String cityCode = "";
        if (entity != null && entity.getCity() != null && !entity.getCity().isEmpty()) {
            // 先按中文名查 code；若查不到，尝试该值是否是有效 code
            String codeByName = liepinService.getCodeByTypeAndName("city", entity.getCity());
            if (codeByName == null || codeByName.isEmpty()) {
                String maybeName = liepinService.getNameByTypeAndCode("city", entity.getCity());
                if (maybeName == null || maybeName.isEmpty() || maybeName.equals(entity.getCity())) {
                    throw new IllegalArgumentException("未在数据库中找到城市编码: " + entity.getCity());
                } else {
                    cityCode = entity.getCity();
                }
            } else {
                cityCode = codeByName;
            }
        }
        config.setCityCode(cityCode);

        // 薪资代码：支持中文名或代码
        String salaryCode = entity != null ? entity.getSalaryCode() : null;
        if (salaryCode == null || salaryCode.isBlank()) {
            config.setSalary("");
        } else {
            String codeByName = liepinService.getCodeByTypeAndName("salary", salaryCode.trim());
            config.setSalary((codeByName != null && !codeByName.isEmpty()) ? codeByName : salaryCode.trim());
        }

        return config;
    }

    /**
     * 统一入口：从专表 boss_config 读取并构建 BossConfig
     */
    public BossConfig getBossConfig() {
        return bossService.loadBossConfig();
    }

    /**
     * 统一入口：从专表 zhilian_config 读取并构建 ZhilianConfig
     */
    public ZhilianConfig getZhilianConfig() {
        return zhilianService.loadZhilianConfig();
    }

    /**
     * 统一入口：从专表 job51_config 读取并构建 Job51Config
     */
    public Job51Config getJob51Config() {
        return job51Service.loadJob51Config();
    }
}
