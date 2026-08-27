package com.getjobs.application.platform;

public record PlatformCapability(
        String platform,
        String qualityTier,
        String collectionMode,
        boolean analysisSupported,
        boolean confirmationSupported,
        String deliveryMode
) {
}
