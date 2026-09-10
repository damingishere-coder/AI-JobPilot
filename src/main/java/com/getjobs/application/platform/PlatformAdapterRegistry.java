package com.getjobs.application.platform;

import org.springframework.stereotype.Component;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

@Component
public class PlatformAdapterRegistry {
    private final Map<String, PlatformAdapter> adapters;

    public PlatformAdapterRegistry(List<PlatformAdapter> adapters) {
        Map<String, PlatformAdapter> indexed = new LinkedHashMap<>();
        for (PlatformAdapter adapter : adapters) {
            String key = normalizePlatform(adapter.platform());
            if (indexed.putIfAbsent(key, adapter) != null) {
                throw new IllegalStateException("平台存在多个正式适配器: " + key);
            }
        }
        this.adapters = Map.copyOf(indexed);
    }

    public PlatformAdapter required(String platform) {
        PlatformAdapter adapter = adapters.get(normalizePlatform(platform));
        if (adapter == null) {
            throw new IllegalArgumentException("不支持的平台: " + platform);
        }
        return adapter;
    }

    public List<PlatformCapability> capabilities() {
        return List.of(
                required(PlatformType.BOSS.code()).capability(),
                required(PlatformType.ZHILIAN.code()).capability(),
                required(PlatformType.LIEPIN.code()).capability(),
                required(PlatformType.JOB51.code()).capability()
        );
    }

    private String normalizePlatform(String platform) {
        if (platform == null || platform.isBlank()) {
            throw new IllegalArgumentException("平台不能为空");
        }
        return platform.trim().toLowerCase(Locale.ROOT);
    }
}
