package com.getjobs.application.controller;

import com.getjobs.application.service.CookieService;
import com.getjobs.worker.manager.PlaywrightManager;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
import java.util.Set;

/** 保留旧路由的明确停用响应，不访问浏览器或历史 Cookie。 */
@RestController
@RequestMapping("/api/cookie")
@RequiredArgsConstructor
public class CookieController {
    // 保留构造兼容；禁止调用这些依赖。
    private final CookieService cookieService;
    private final PlaywrightManager playwrightManager;
    private static final Set<String> PLATFORMS = Set.of("boss", "zhilian", "liepin", "51job");

    public static ResponseEntity<Map<String, Object>> retired(String platform) {
        if (!PLATFORMS.contains(platform)) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "不支持的平台"));
        }
        return ResponseEntity.status(410).body(Map.of(
                "success", false, "errorCode", "BROWSER_SESSION_ONLY", "platform", platform,
                "message", "Cookie 保存和读取已停用。请在浏览器中手动登录；会话仅由浏览器保存，历史数据库记录保留。"));
    }

    @GetMapping
    public ResponseEntity<Map<String, Object>> getCookie(@RequestParam("platform") String platform) {
        return retired(platform);
    }

    @PostMapping("/save")
    public ResponseEntity<Map<String, Object>> saveCookie(@RequestParam("platform") String platform,
            @RequestParam(value = "remark", defaultValue = "manual save") String remark) {
        return retired(platform);
    }
}
