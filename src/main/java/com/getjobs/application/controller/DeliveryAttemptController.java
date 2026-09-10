package com.getjobs.application.controller;

import com.getjobs.application.service.DeliveryAttemptService;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/delivery-attempts")
@RequiredArgsConstructor
public class DeliveryAttemptController {
    private final DeliveryAttemptService deliveryAttemptService;

    @GetMapping
    public List<DeliveryAttemptService.AttemptView> listRecent(
            @RequestParam("platform") String platform,
            @RequestParam(value = "limit", defaultValue = "20") int limit) {
        return deliveryAttemptService.listRecentForCurrentProfile(platform, limit);
    }
}
