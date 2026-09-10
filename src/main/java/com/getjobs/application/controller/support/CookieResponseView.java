package com.getjobs.application.controller.support;

import com.getjobs.application.entity.CookieEntity;

import java.util.LinkedHashMap;
import java.util.Map;

/**
 * 构造 Cookie 查询接口的安全响应，只暴露状态和非敏感元数据。
 */
public final class CookieResponseView {
    private CookieResponseView() {
    }

    public static Map<String, Object> from(CookieEntity cookie, String platform, String missingMessage) {
        Map<String, Object> data = new LinkedHashMap<>();
        if (cookie == null) {
            data.put("platform", platform);
            data.put("configured", false);
            data.put("message", missingMessage);
            return data;
        }

        data.put("id", cookie.getId());
        data.put("platform", cookie.getPlatform());
        data.put("configured", cookie.getCookieValue() != null && !cookie.getCookieValue().isBlank());
        data.put("remark", cookie.getRemark());
        data.put("created_at", cookie.getCreatedAt());
        data.put("updated_at", cookie.getUpdatedAt());
        return data;
    }
}
