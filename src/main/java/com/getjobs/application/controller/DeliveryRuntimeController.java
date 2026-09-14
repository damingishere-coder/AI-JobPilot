package com.getjobs.application.controller;

import com.getjobs.application.service.DeliveryRuntimeService;
import com.getjobs.application.service.LocalActionTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.util.Map;

@RestController
@RequestMapping("/api/delivery-attempts/{requestKey}/runtime")
@RequiredArgsConstructor
public class DeliveryRuntimeController {
    private final DeliveryRuntimeService runtime;
    private final LocalActionTokenService tokens;

    @PostMapping("/claim")
    public ResponseEntity<?> claim(@PathVariable String requestKey, @RequestBody DeliveryRuntimeService.Claim request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME, required=false) String token) {
        if (!tokens.isValid(token)) return unauthorized();
        return response(runtime.claim(requestKey, request));
    }
    @PostMapping("/begin")
    public ResponseEntity<?> begin(@PathVariable String requestKey, @RequestBody DeliveryRuntimeService.Begin request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME, required=false) String token) {
        if (!tokens.isValid(token)) return unauthorized();
        return response(runtime.begin(requestKey, request));
    }
    @GetMapping
    public Object timeline(@PathVariable String requestKey) { return runtime.timeline(requestKey); }
    @PostMapping("/pause")
    public ResponseEntity<?> pause(@PathVariable String requestKey,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME, required=false) String token) {
        if (!tokens.isValid(token)) return unauthorized();
        return response(runtime.pause(requestKey));
    }
    @PostMapping("/observe")
    public ResponseEntity<?> observe(@PathVariable String requestKey, @RequestBody DeliveryRuntimeService.Observation request,
            @RequestHeader(value=LocalActionTokenService.HEADER_NAME, required=false) String token) {
        if (!tokens.isValid(token)) return unauthorized();
        return response(runtime.observe(requestKey, request));
    }
    private ResponseEntity<?> response(Map<String, Object> result) {
        return ResponseEntity.status(Boolean.TRUE.equals(result.get("success")) ? 200 : 409).body(result);
    }
    private ResponseEntity<?> unauthorized() {
        return ResponseEntity.status(401).body(Map.of("success", false, "message", "本地操作令牌无效，请刷新页面"));
    }
}
