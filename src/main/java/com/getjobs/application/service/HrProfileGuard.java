package com.getjobs.application.service;

import org.springframework.stereotype.Component;
import java.util.function.BooleanSupplier;
import java.util.function.Supplier;

/** Serializes profile transactions with watch admission and send-command leases. */
@Component
public class HrProfileGuard {
    private BooleanSupplier blocked = () -> false;
    private final java.util.List<BooleanSupplier> additionalBlockers = new java.util.ArrayList<>();

    public synchronized void registerBlocker(BooleanSupplier blocker) {
        blocked = blocker;
    }

    public synchronized void registerAdditionalBlocker(BooleanSupplier blocker) { additionalBlockers.add(blocker); }

    public synchronized <T> T locked(Supplier<T> action) {
        return action.get();
    }

    public synchronized boolean isBlocked() {
        return blocked.getAsBoolean() || additionalBlockers.stream().anyMatch(BooleanSupplier::getAsBoolean);
    }

    public synchronized void requireChangeAllowed() {
        if (isBlocked()) throw new WatchActiveException();
    }

    public static class WatchActiveException extends IllegalStateException {
        public WatchActiveException() {
            super("请先停止值守再切换人物档案；若仍有采集或发送任务，请等待处理完成");
        }
    }
}
