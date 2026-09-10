package com.getjobs.application.controller;

import com.getjobs.application.service.GreetingDraftService;
import com.getjobs.application.service.LocalActionTokenService;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/platforms/{platform}/jobs/{jobId}/greeting")
@RequiredArgsConstructor
public class GreetingDraftController {
    private final GreetingDraftService greetingDraftService;
    private final LocalActionTokenService localActionTokenService;

    @GetMapping
    public ResponseEntity<?> get(@PathVariable String platform, @PathVariable Long jobId) {
        return execute(() -> greetingDraftService.resolveForJob(platform, jobId));
    }

    @PostMapping
    public ResponseEntity<?> save(@PathVariable String platform,
                                  @PathVariable Long jobId,
                                  @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
                                  @RequestBody GreetingDraftRequest request) {
        if (!localActionTokenService.isValid(actionToken)) {
            return unauthorized();
        }
        if (request == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "沟通草稿请求不能为空"));
        }
        return execute(() -> greetingDraftService.save(
                platform, jobId, request.getContent(), request.getExpectedUpdatedAt()));
    }

    @DeleteMapping
    public ResponseEntity<?> reset(@PathVariable String platform,
                                   @PathVariable Long jobId,
                                   @RequestHeader(value = LocalActionTokenService.HEADER_NAME, required = false) String actionToken,
                                   @RequestParam(required = false) String expectedUpdatedAt) {
        if (!localActionTokenService.isValid(actionToken)) {
            return unauthorized();
        }
        return execute(() -> greetingDraftService.reset(platform, jobId, expectedUpdatedAt));
    }

    private ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(HttpStatus.UNAUTHORIZED)
                .body(Map.of("success", false, "message", "本地操作令牌无效，请刷新页面后重试"));
    }

    private ResponseEntity<?> execute(GreetingAction action) {
        try {
            return ResponseEntity.ok(Map.of("success", true, "data", action.run()));
        } catch (GreetingDraftService.StaleDraftException e) {
            return ResponseEntity.status(HttpStatus.CONFLICT)
                    .body(Map.of("success", false, "message", e.getMessage()));
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }

    @FunctionalInterface
    private interface GreetingAction {
        GreetingDraftService.GreetingView run();
    }

    @Data
    public static class GreetingDraftRequest {
        private String content;
        private String expectedUpdatedAt;
    }
}
