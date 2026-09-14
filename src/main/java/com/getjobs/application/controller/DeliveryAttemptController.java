package com.getjobs.application.controller;

import com.getjobs.application.service.DeliveryAttemptService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.http.ResponseEntity;
import com.getjobs.application.service.LocalActionTokenService;

import java.util.List;
import java.util.Map;

@RestController
@RequestMapping("/api/delivery-attempts")
@RequiredArgsConstructor
public class DeliveryAttemptController {
    @org.springframework.beans.factory.annotation.Value("${application.runtime.boss-enabled:false}")
    private boolean bossRuntimeEnabled;
    private final DeliveryAttemptService deliveryAttemptService;
    private final LocalActionTokenService localActionTokenService;

    @GetMapping("/runtime-capabilities")
    public Map<String,Object> runtimeCapabilities() {
        return Map.of("protocol","application-runtime/1","bossEnabled",bossRuntimeEnabled,"zhilianEnabled",false);
    }

    @GetMapping("/recovery")
    public List<Map<String, Object>> recovery(@RequestParam("platform") String platform, @RequestParam("date") String date) {
        return deliveryAttemptService.recoveryList(platform, date);
    }

    @PostMapping("/{requestKey}/resume")
    public ResponseEntity<?> resume(@PathVariable("requestKey") String requestKey, @RequestBody ResumeRequest request,
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String token) {
        if (!localActionTokenService.isValid(token)) return ResponseEntity.status(401)
                .body(Map.of("success", false, "message", "本地操作令牌无效，请刷新页面后重试"));
        return ResponseEntity.ok(deliveryAttemptService.prepareRecovery(requestKey, request.profileId()));
    }

    public record ResumeRequest(long profileId) {}

    @PostMapping("/{requestKey}/validate-dispatch")
    public ResponseEntity<?> validateDispatch(@PathVariable("requestKey") String requestKey,
            @RequestBody DispatchRequest request,
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String token) {
        if (!localActionTokenService.isValid(token)) return ResponseEntity.status(401)
                .body(Map.of("success", false, "message", "本地操作令牌无效，请刷新页面后重试"));
        boolean valid = request != null && request.platform() != null
                && (!bossRuntimeEnabled || !"boss".equals(request.platform()) || request.reconciliationOnly() || request.runtimeClient())
                && deliveryAttemptService.validateDispatch(requestKey, request.platform(), request.profileId(),
                request.id(), request.url(), request.greeting(), request.reconciliationOnly());
        return ResponseEntity.status(valid ? 200 : 409).body(Map.of("success", valid,
                "message", valid ? "已核对确认快照" : "确认记录或任务快照已变化，已停止派发，请刷新后核对"));
    }

    public record DispatchRequest(String platform, long profileId, long id, String url,
                                  String greeting, boolean reconciliationOnly, boolean runtimeClient) {}

    @GetMapping
    public List<DeliveryAttemptService.AttemptView> listRecent(
            @RequestParam("platform") String platform,
            @RequestParam(value = "limit", defaultValue = "20") int limit) {
        return deliveryAttemptService.listRecentForCurrentProfile(platform, limit);
    }
}
