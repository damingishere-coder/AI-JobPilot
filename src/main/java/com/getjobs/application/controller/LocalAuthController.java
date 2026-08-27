package com.getjobs.application.controller;

import com.getjobs.application.service.LocalActionTokenService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/api/local-auth")
@RequiredArgsConstructor
public class LocalAuthController {
    private final LocalActionTokenService localActionTokenService;

    @GetMapping("/action-token")
    public Map<String, Object> actionToken() {
        return Map.of(
                "success", true,
                "data", Map.of("token", localActionTokenService.issueToken())
        );
    }
}
