package com.getjobs.application.controller;

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

import java.util.Map;

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
        return execute(() -> {
            Long profileId = profileService.getCurrentProfileId();
            if (request.getExpectedProfileId() != null && !request.getExpectedProfileId().equals(profileId)) {
                throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新加载设置后再保存");
            }
            return store.saveSettings(profileId, request.getCommunicationProfile(), request.isQqEnabled(),
                    request.getNapcatWsUrl(), request.getNapcatToken(), request.getQqTargetType(),
                    request.getQqTarget(), request.getQqOperator(), request.getRetentionDays());
        });
    }

    @GetMapping("/status")
    public ResponseEntity<?> status() {
        return execute(watchService::status);
    }

    @PostMapping("/watch/start")
    public ResponseEntity<?> start(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        return execute(watchService::start);
    }

    @PostMapping("/watch/stop")
    public ResponseEntity<?> stop(
            @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken) {
        if (!localActionTokenService.isValid(actionToken)) return unauthorized();
        return execute(watchService::stop);
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
        try {
            return ResponseEntity.ok(Map.of("success", true, "data", action.run()));
        } catch (HrAssistantStore.StaleProposalException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT).body(Map.of("success", false, "message", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return badRequest(e.getMessage());
        } catch (IllegalStateException e) {
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE)
                    .body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    private ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("success", false, "message", "本地操作令牌无效，请刷新页面后重试"));
    }

    private ResponseEntity<?> badRequest(String message) {
        return ResponseEntity.badRequest().body(Map.of("success", false, "message", message));
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
}
