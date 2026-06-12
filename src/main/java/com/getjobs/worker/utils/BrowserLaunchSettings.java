package com.getjobs.worker.utils;

import com.getjobs.application.config.CrossPlatformPathSupport;

import java.nio.file.Path;
import java.util.Optional;

public record BrowserLaunchSettings(
        Optional<Path> userDataDir,
        Optional<Path> executablePath,
        Optional<String> channel,
        boolean headless,
        double slowMoMs
) {
    public static BrowserLaunchSettings from(
            String userDataDir,
            String executablePath,
            String channel,
            boolean headless,
            double slowMoMs
    ) {
        return new BrowserLaunchSettings(
                CrossPlatformPathSupport.resolveOptionalPath(userDataDir),
                CrossPlatformPathSupport.resolveOptionalPath(executablePath),
                normalizeOptionalText(channel),
                headless,
                slowMoMs
        );
    }

    public boolean usesPersistentContext() {
        return userDataDir.isPresent();
    }

    private static Optional<String> normalizeOptionalText(String value) {
        if (CrossPlatformPathSupport.isBlank(value)) {
            return Optional.empty();
        }
        return Optional.of(value.trim());
    }
}
