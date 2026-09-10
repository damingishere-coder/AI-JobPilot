package com.getjobs.application.controller;

import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
import com.getjobs.application.service.HrAssistantEventService;
import com.getjobs.application.service.HrAssistantStore;
import com.getjobs.application.service.HrAssistantWatchService;
import com.getjobs.application.service.HrReplyActionService;
import com.getjobs.application.service.LocalActionTokenService;
import com.getjobs.application.service.ProfileService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Slf4j
@RestController
@RequestMapping("/api/hr-assistant")
@RequiredArgsConstructor
public class HrAssistantController {
    private final ProfileService profileService;
    private final HrAssistantStore store;
    private final HrAssistantWatchService watchService;
    private final HrReplyActionService actionService;
    private final HrAssistantEventService eventService;
    private final LocalActionTokenService localActionTokenService;

    private com.getjobs.application.service.HrProfileGuard profileGuard = new com.getjobs.application.service.HrProfileGuard();
    @org.springframework.beans.factory.annotation.Autowired
    public void setProfileGuard(com.getjobs.application.service.HrProfileGuard guard) { this.profileGuard=guard; }
    private com.getjobs.application.service.HrAutopilotStore autopilot;
    @org.springframework.beans.factory.annotation.Autowired
    public void setAutopilot(com.getjobs.application.service.HrAutopilotStore autopilot) { this.autopilot=autopilot; }

    @GetMapping("/autopilot")
    public ResponseEntity<?> autopilot() { return execute(()-> {
        Long id=profileService.getCurrentProfileId();
        var result=new java.util.LinkedHashMap<String,Object>();
        var p=autopilot.policy(id);
        result.put("version",p.version()); result.put("enabled",p.enabled()); result.put("paused",p.paused());
        result.put("resumeName",p.resumeName()); result.put("resumeSha256",p.resumeSha256()); result.put("facts",p.facts());
        result.put("rules",p.rules()); result.put("pendingFact",p.pendingFact()); result.put("authorizationValid",autopilot.authorizationValid(id));
        return result;
    }); }

    @GetMapping("/autopilot/deliveries")
    public ResponseEntity<?> deliveryCounts() { return execute(()->autopilot.deliveryCounts(profileService.getCurrentProfileId())); }

    @PutMapping("/autopilot")
    public ResponseEntity<?> saveAutopilot(@RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token,
                                           @RequestBody AutopilotRequest request) {
        if(!localActionTokenService.isValid(token)) return unauthorized();
        return execute(()-> profileGuard.locked(()-> {
            Long id=profileService.getCurrentProfileId();
            if(!id.equals(request.profileId())) throw new HrAssistantStore.StaleProposalException("当前人物档案已变化");
            if(watchService.status().watching() || watchService.status().scanRunning() || store.hasLeasedSendCommands())
                throw new IllegalStateException("请先停止值守并等待发送结果后再修改托管授权");
            if(!request.rulesConfirmed()) throw new IllegalArgumentException("请先核对并确认托管规则");
            return autopilot.configure(id,request.expectedVersion(),request.enabled(),request.resumeName(),request.resumeSha256());
        }));
    }
    public record AutopilotRequest(Long profileId,int expectedVersion,boolean enabled,boolean rulesConfirmed,String resumeName,String resumeSha256) { }

    @PostMapping("/autopilot/{operation:pause|resume}")
    public ResponseEntity<?> pauseAutopilot(@PathVariable String operation,@RequestHeader(value=LocalActionTokenService.HEADER_NAME,required=false) String token) {
        if(!localActionTokenService.isValid(token)) return unauthorized();
        return execute(()->autopilot.pause(profileService.getCurrentProfileId(),operation.equals("pause")));
    }

    @GetMapping("/proposals/{id}/context")
    public ResponseEntity<?> context(@PathVariable long id) {
        return execute(()-> {
            Long profileId=profileService.getCurrentProfileId();
            return autopilot.context(profileId,store.requireProposal(profileId,id).conversationId());
        });
    }

    @GetMapping("/settings")
    public ResponseEntity<?> settings() {
        return execute(() -> store.loadSettings(profileService.getCurrentProfileId()));
    }

    @PutMapping("/settings")
    public ResponseEntity<?> saveSettings(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody SettingsRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("设置请求不能为空");
        return execute(() -> profileGuard.locked(() -> {
            profileGuard.requireChangeAllowed();
            Long profileId = profileService.getCurrentProfileId();
            if (request.getExpectedProfileId() != null && !request.getExpectedProfileId().equals(profileId)) {
                throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新加载设置后再保存");
            }
            return store.saveSettings(profileId, request.getCommunicationProfile(), request.isQqEnabled(),
                    request.getNapcatWsUrl(), request.getNapcatToken(), request.getQqTargetType(),
                    request.getQqTarget(), request.getQqOperator(), request.getRetentionDays());
        }));
    }

    @GetMapping("/status")
    public ResponseEntity<?> status() {
        return execute(watchService::status);
    }

    @PostMapping("/watch/start")
    public ResponseEntity<?> start(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody WatchStartRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("值守启动请求不能为空");
        return execute(() -> watchService.start(request.getTabId(), request.getUrl(), request.getContentVersion(),
                request.getBrowserSessionId(), request.getExpectedProfileId(), request.getIntervalMinutes()));
    }

    @PostMapping("/watch/heartbeat")
    public ResponseEntity<?> heartbeat(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody WatchHeartbeatRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("值守心跳请求不能为空");
        return execute(() -> watchService.heartbeat(request.getWatchSessionId(), request.getTabId(), request.getUrl(),
                request.getContentVersion(), request.isScanRunning(), request.getOutboxCount(), request.getFault()));
    }

    @PostMapping("/watch/scan-results")
    public ResponseEntity<?> scanResults(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody ScanResultsRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("扫描结果不能为空");
        return execute(() -> watchService.ingestScan(request.getWatchSessionId(), request.getTabId(),
                request.getScanId(), request.getTotalUnread(), request.getCaptures()));
    }

    @PostMapping("/watch/stop")
    public ResponseEntity<?> stop(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody(required = false) WatchStopRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        return execute(() -> watchService.stop(request == null ? "" : request.getWatchSessionId(),
                request == null ? "用户主动停止" : request.getReason()));
    }

    @PostMapping("/send-commands/claim")
    public ResponseEntity<?> claimSendCommand(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody SendCommandClaimRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("发送命令领取请求不能为空");
        return execute(() -> {
            Long profileId = profileService.getCurrentProfileId();
            return watchService.withSession(profileId, request.getWatchSessionId(), request.getTabId(), false,
                    () -> actionService.claim(profileId, request.getWatchSessionId()));
        });
    }

    @PostMapping("/send-commands/{id}/result")
    public ResponseEntity<?> completeSendCommand(
            @PathVariable String id,
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody SendCommandResultRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("发送结果不能为空");
        return execute(() -> {
            Long profileId = profileService.getCurrentProfileId();
            return watchService.withSession(profileId, request.getWatchSessionId(), request.getTabId(), true,
                    () -> actionService.complete(profileId, request.getWatchSessionId(), id, request.getLeaseToken(),
                    request.getOutcome(), request.getEvidence(), request.getObservedLatestInbound()));
        });
    }

    @GetMapping("/proposals")
    public ResponseEntity<?> proposals(@RequestParam(defaultValue = "false") boolean includeClosed) {
        return execute(() -> store.listProposals(profileService.getCurrentProfileId(), includeClosed));
    }

    @PostMapping("/proposals/{id}/revise")
    public ResponseEntity<?> revise(
            @PathVariable long id,
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody ProposalActionRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("修改请求不能为空");
        return execute(() -> actionService.revise(profileService.getCurrentProfileId(), id,
                request.getExpectedVersion(), request.getDraft()));
    }

    @PostMapping("/proposals/{id}/send")
    public ResponseEntity<?> send(
            @PathVariable long id,
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
            @RequestBody ProposalActionRequest request) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        if (request == null) return badRequest("发送请求不能为空");
        return execute(() -> actionService.send(profileService.getCurrentProfileId(), id, request.getExpectedVersion()));
    }

    @PostMapping("/proposals/{id}/skip")
    public ResponseEntity<?> skip(
            @PathVariable long id,
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        return execute(() -> actionService.skip(profileService.getCurrentProfileId(), id));
    }

    @GetMapping("/events")
    public SseEmitter events() {
        return eventService.subscribe();
    }

    private ResponseEntity<?> execute(Action action) {
        String requestId = UUID.randomUUID().toString();
        try {
            return ResponseEntity.ok(envelope(true, "", "", requestId, action.run()));
        } catch (com.getjobs.application.service.HrProfileGuard.WatchActiveException e) {
            return failure(HttpStatus.CONFLICT, "HR_WATCH_ACTIVE", e.getMessage(), requestId);
        } catch (HrAssistantStore.StaleProposalException e) {
            return failure(HttpStatus.CONFLICT, "STALE_STATE", e.getMessage(), requestId);
        } catch (IllegalArgumentException e) {
            return failure(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", e.getMessage(), requestId);
        } catch (IllegalStateException e) {
            return failure(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", e.getMessage(), requestId);
        } catch (Throwable error) {
            log.error("HR assistant request failed requestId={} type={}", requestId, error.getClass().getSimpleName());
            return failure(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "本地服务处理失败，请根据错误编号检查日志", requestId);
        }
    }

    private ResponseEntity<?> unauthorized() {
        String requestId = UUID.randomUUID().toString();
        return failure(HttpStatus.UNAUTHORIZED, "ACTION_TOKEN_INVALID", "本地操作令牌无效，请刷新页面后重试", requestId);
    }

    private ResponseEntity<?> badRequest(String message) {
        String requestId = UUID.randomUUID().toString();
        return failure(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", message, requestId);
    }

    private ResponseEntity<?> failure(HttpStatus status, String errorCode, String message, String requestId) {
        return ResponseEntity.status(status).body(envelope(false, errorCode, safeMessage(message), requestId, null));
    }

    private Map<String, Object> envelope(boolean success, String errorCode, String message, String requestId, Object data) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", success);
        response.put("errorCode", errorCode);
        response.put("message", message);
        response.put("requestId", requestId);
        if (success) response.put("data", data);
        return response;
    }

    private String safeMessage(String message) {
        return message == null || message.isBlank() ? "请求处理失败" : message;
    }

    @FunctionalInterface
    private interface Action {
        Object run();
    }

    @Data
    public static class SettingsRequest {
        private Long expectedProfileId;
        private CommunicationProfile communicationProfile;
        private boolean qqEnabled;
        private String napcatWsUrl;
        private String napcatToken;
        private QqTargetType qqTargetType;
        private String qqTarget;
        private String qqOperator;
        private int retentionDays = 30;
    }

    @Data
    public static class ProposalActionRequest {
        private int expectedVersion;
        private String draft;
    }

    @Data
    public static class WatchStartRequest {
        private int intervalMinutes = 1;
        private int tabId;
        private String url;
        private String contentVersion;
        private String browserSessionId;
        private Long expectedProfileId;
    }

    @Data
    public static class WatchHeartbeatRequest {
        private String watchSessionId;
        private int tabId;
        private String url;
        private String contentVersion;
        private boolean scanRunning;
        private int outboxCount;
        private String fault;
    }

    @Data
    public static class ScanResultsRequest {
        private String watchSessionId;
        private int tabId;
        private String scanId;
        private int totalUnread;
        private List<ChatCapture> captures = List.of();
    }

    @Data
    public static class WatchStopRequest {
        private String watchSessionId;
        private String reason;
    }

    @Data
    public static class SendCommandClaimRequest {
        private String watchSessionId;
        private int tabId;
    }

    @Data
    public static class SendCommandResultRequest {
        private String watchSessionId;
        private int tabId;
        private String leaseToken;
        private String outcome;
        private String evidence;
        private ChatMessage observedLatestInbound;
    }
}
