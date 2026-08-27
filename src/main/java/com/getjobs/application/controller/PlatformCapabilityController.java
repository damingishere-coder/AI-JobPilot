package com.getjobs.application.controller;

import com.getjobs.application.platform.PlatformAdapterRegistry;
import com.getjobs.application.platform.PlatformCapability;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/platforms")
@RequiredArgsConstructor
public class PlatformCapabilityController {
    private final PlatformAdapterRegistry platformAdapterRegistry;

    @GetMapping("/capabilities")
    public List<PlatformCapability> capabilities() {
        return platformAdapterRegistry.capabilities();
    }
}
