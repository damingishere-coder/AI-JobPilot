package com.getjobs.worker.service;

import org.springframework.stereotype.Service;

import java.util.Optional;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Prevents platform automation jobs from sharing the Playwright context concurrently.
 */
@Service
public class JobRunCoordinator {
    private final AtomicReference<String> activePlatform = new AtomicReference<>();
    private final Set<String> cancelledRunIds = ConcurrentHashMap.newKeySet();

    public boolean tryStart(String platform) {
        return activePlatform.compareAndSet(null, platform);
    }

    public void finish(String platform) {
        activePlatform.compareAndSet(platform, null);
    }

    public Optional<String> getActivePlatform() {
        return Optional.ofNullable(activePlatform.get());
    }

    public boolean isRunning() {
        return activePlatform.get() != null;
    }

    public boolean isRunningForAnotherPlatform(String platform) {
        String active = activePlatform.get();
        return active != null && !active.equals(platform);
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
