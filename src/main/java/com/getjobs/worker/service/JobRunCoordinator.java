package com.getjobs.worker.service;

import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks platform automation jobs independently.
 */
@Service
public class JobRunCoordinator {
    private final Set<String> activePlatforms = ConcurrentHashMap.newKeySet();
    private final Set<String> cancelledRunIds = ConcurrentHashMap.newKeySet();

    public boolean tryStart(String platform) {
        if (platform == null || platform.isBlank()) {
            return false;
        }
        return activePlatforms.add(platform);
    }

    public void finish(String platform) {
        if (platform != null && !platform.isBlank()) {
            activePlatforms.remove(platform);
        }
    }

    public Optional<String> getActivePlatform() {
        return activePlatforms.stream().findFirst();
    }

    public boolean isRunning() {
        return !activePlatforms.isEmpty();
    }

    public boolean isRunningForAnotherPlatform(String platform) {
        return activePlatforms.stream().anyMatch(active -> !active.equals(platform));
    }

    public boolean isRunningForPlatform(String platform) {
        return platform != null && !platform.isBlank() && activePlatforms.contains(platform);
    }

    public void requestCancel(String runId) {
        if (runId != null && !runId.isBlank()) {
            cancelledRunIds.add(runId);
        }
    }

    public boolean isCancelRequested(String runId) {
        return runId != null && !runId.isBlank() && cancelledRunIds.contains(runId);
    }

    public void clearCancel(String runId) {
        if (runId != null && !runId.isBlank()) {
            cancelledRunIds.remove(runId);
        }
    }
}
