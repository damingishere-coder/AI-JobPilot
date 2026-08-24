package com.getjobs.application.service;

import com.getjobs.worker.dto.JobProgressMessage;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

/**
 * 持久 AI 任务的进程内执行器。任务生命周期由 JobAnalysisTaskStore 管理，线程池不是真相源。
 */
@Slf4j
@Service
public class ChromeJobAnalysisQueueService {
    private static final int AI_CONCURRENCY = 2;
    private static final int LOCAL_QUEUE_CAPACITY = 200;
    private static final Duration LEASE_DURATION = Duration.ofMinutes(5);
    private static final long LEASE_HEARTBEAT_SECONDS = 60;

    private final JobAiAnalysisService jobAiAnalysisService;
    private final JobAnalysisTaskStore taskStore;
    private final ThreadPoolExecutor executor;
    private final ScheduledExecutorService leaseHeartbeatExecutor;
    private final java.util.Set<Long> locallyScheduledTaskIds = ConcurrentHashMap.newKeySet();
    private final Map<Long, AnalysisJob> runtimeJobs = new ConcurrentHashMap<>();
    private volatile boolean stopping;

    public ChromeJobAnalysisQueueService(JobAiAnalysisService jobAiAnalysisService,
                                         JobAnalysisTaskStore taskStore) {
        this.jobAiAnalysisService = jobAiAnalysisService;
        this.taskStore = taskStore;
        this.executor = new ThreadPoolExecutor(
                AI_CONCURRENCY,
                AI_CONCURRENCY,
                60L,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(LOCAL_QUEUE_CAPACITY),
                new NamedThreadFactory(),
                new ThreadPoolExecutor.AbortPolicy()
        );
        this.executor.allowCoreThreadTimeOut(false);
        this.leaseHeartbeatExecutor = java.util.concurrent.Executors.newSingleThreadScheduledExecutor(
                new LeaseHeartbeatThreadFactory());
    }

    @PostConstruct
    public void initialize() {
        recoverOrphanedAnalyzingTasks();
        reconcileExpiredLeases();
        dispatchPendingTasks();
    }

    public EnqueueResult enqueue(AnalysisJob job) {
        if (job == null || job.getRequest() == null) {
            return EnqueueResult.skipped("分析任务为空");
        }
        if (DeliveryStatus.isFinalStatus(job.getCurrentStatus())) {
            return EnqueueResult.skipped("岗位已完成 AI 分析或投递处理");
        }

        try {
            JobAnalysisTaskStore.SubmitResult submitted = taskStore.submit(job.getRequest());
            if (!submitted.accepted() || submitted.task() == null) {
                return EnqueueResult.rejected(submitted.message());
            }
            JobAnalysisTaskStore.TaskRecord task = submitted.task();
            if (task.statusEnum() == JobAnalysisTaskStore.Status.PENDING) {
                if (job.getProgressCallback() != null) {
                    runtimeJobs.put(task.id(), job);
                }
                schedule(task.id());
            }
            if (!submitted.created()) {
                return EnqueueResult.skipped(submitted.message());
            }
            return EnqueueResult.queued(queueSize());
        } catch (IllegalArgumentException e) {
            return EnqueueResult.rejected(e.getMessage());
        } catch (Exception e) {
            log.error("持久化 Chrome AI 分析任务失败", e);
            return EnqueueResult.rejected("AI 分析任务持久化失败，请稍后重试");
        }
    }

    public int queueSize() {
        return taskStore.outstandingCount();
    }

    public int queueSize(long profileId) {
        return taskStore.outstandingCount(profileId);
    }

    /**
     * Readiness 只读取本地执行器和持久任务计数，不调用任何 AI Provider。
     */
    public QueueHealth healthSnapshot() {
        return new QueueHealth(
                !stopping && !executor.isShutdown(),
                stopping,
                taskStore.outstandingCount(),
                executor.getActiveCount(),
                executor.getQueue().size(),
                executor.getQueue().remainingCapacity()
        );
    }

    public java.util.List<JobAnalysisTaskStore.TaskView> listTasks(long profileId, int limit) {
        return taskStore.listRecent(profileId, limit);
    }

    public JobAnalysisTaskStore.RetryResult retry(long taskId, long profileId, boolean confirmUnknown) {
        JobAnalysisTaskStore.TaskRecord current = taskStore.findByIdAndProfile(taskId, profileId);
        if (current != null
                && current.statusEnum() == JobAnalysisTaskStore.Status.UNKNOWN
                && confirmUnknown) {
            JobAiAnalysisService.JobAnalysisRequest request = taskStore.deserialize(current);
            JobAiAnalysisService.PlatformAnalysisState platformState =
                    jobAiAnalysisService.inspectPlatformAnalysis(request);
            if (DeliveryStatus.AI_ANALYZING.equals(platformState.status())
                    && !jobAiAnalysisService.markAnalysisInterrupted(
                            request, "用户已确认 UNKNOWN 任务，重试前安全复位 AI 分析状态")) {
                return JobAnalysisTaskStore.RetryResult.rejected(
                        "岗位仍处于 AI 分析中且安全复位失败，未重新调用 AI Provider；请稍后重试");
            }
        }
        JobAnalysisTaskStore.RetryResult result = taskStore.retry(taskId, profileId, confirmUnknown);
        if (result.accepted() && result.task() != null) {
            schedule(result.task().id());
        }
        return result;
    }

    @Scheduled(fixedDelay = 15000)
    public void maintainDurableQueue() {
        if (stopping) return;
        reconcileExpiredLeases();
        dispatchPendingTasks();
    }

    void dispatchPendingTasks() {
        if (stopping) return;
        for (JobAnalysisTaskStore.TaskRecord task : taskStore.listDuePending(LOCAL_QUEUE_CAPACITY)) {
            schedule(task.id());
        }
    }

    void reconcileExpiredLeases() {
        if (stopping) return;
        for (JobAnalysisTaskStore.TaskRecord task : taskStore.listExpiredLeases(LOCAL_QUEUE_CAPACITY)) {
            reconcileExpiredLease(task);
        }
    }

    void recoverOrphanedAnalyzingTasks() {
        if (stopping) return;
        String reason = "升级或异常退出前的 AI 任务上下文已丢失，已登记为 UNKNOWN；请人工确认后显式重试";
        while (!stopping) {
            java.util.List<JobAiAnalysisService.JobAnalysisRequest> orphaned =
                    taskStore.listOrphanedAnalyzingRequests(LOCAL_QUEUE_CAPACITY);
            if (orphaned.isEmpty()) return;
            int created = 0;
            for (JobAiAnalysisService.JobAnalysisRequest request : orphaned) {
                try {
                    JobAnalysisTaskStore.SubmitResult recorded = taskStore.recordUnknown(request, reason);
                    if (recorded.created() && recorded.task() != null) {
                        created++;
                        jobAiAnalysisService.markAnalysisInterrupted(request, reason);
                    }
                } catch (Exception e) {
                    log.warn("登记遗留 AI 分析中岗位失败: platform={}, rowId={}, error={}",
                            request.getPlatform(), request.getJobRowId(), e.getMessage(), e);
                }
            }
            if (orphaned.size() < LOCAL_QUEUE_CAPACITY || created == 0) return;
        }
    }

    private void schedule(long taskId) {
        if (stopping || !locallyScheduledTaskIds.add(taskId)) return;
        try {
            executor.execute(() -> runPersistedTask(taskId));
        } catch (RejectedExecutionException e) {
            locallyScheduledTaskIds.remove(taskId);
            log.debug("本地 AI executor 已满，任务 {} 保留为 PENDING", taskId);
        }
    }

    private void runPersistedTask(long taskId) {
        String leaseToken = UUID.randomUUID().toString();
        JobAnalysisTaskStore.TaskRecord claimed = null;
        JobAiAnalysisService.JobAnalysisRequest request = null;
        ScheduledFuture<?> heartbeat = null;
        try {
            claimed = taskStore.claim(taskId, leaseToken, LEASE_DURATION);
            if (claimed == null) return;
            heartbeat = startLeaseHeartbeat(taskId, leaseToken);

            request = taskStore.deserialize(claimed);
            AnalysisJob runtimeJob = runtimeJobs.get(taskId);
            Consumer<JobProgressMessage> progress = runtimeJob == null ? null : runtimeJob.getProgressCallback();
            int current = runtimeJob == null ? 0 : runtimeJob.getCurrent();
            int total = runtimeJob == null ? 0 : runtimeJob.getTotal();
            String platform = Objects.toString(request.getPlatform(), "");
            String jobName = Objects.toString(request.getJobName(), "");

            emit(progress, JobProgressMessage.progress(platform, "AI分析中：" + jobName, current, total));
            JobAiAnalysisService.AnalysisResult result = jobAiAnalysisService.analyzeJob(
                    request,
                    () -> taskStore.isLeaseOwner(taskId, leaseToken),
                    action -> taskStore.executeWithLease(taskId, leaseToken, action)
            );
            if (result.isStaleLease()) {
                log.warn("AI 任务 {} 的租约已失效，旧执行结果已丢弃", taskId);
                return;
            }
            boolean failed = result.isFailure();
            String summary = Objects.toString(result.getSummary(), "");
            boolean completed = result.isProviderOutcomeUnknown()
                    ? taskStore.completeUnknown(taskId, leaseToken, summary)
                    : taskStore.complete(taskId, leaseToken, failed, summary);
            if (!completed && !result.isProviderOutcomeUnknown()) {
                reconcileLateWorkerResult(claimed, leaseToken, failed, summary);
            }
            if (!completed && result.isProviderOutcomeUnknown()) {
                log.warn("AI 任务 {} 的 UNKNOWN 终态写入未命中当前租约，将等待过期对账", taskId);
            }

            if (result.isProviderOutcomeUnknown()) {
                emit(progress, JobProgressMessage.warning(
                        platform, "AI分析结果未知：" + jobName + "，" + summary));
            } else if (failed) {
                emit(progress, JobProgressMessage.warning(platform, "AI分析失败：" + jobName + "，" + summary));
            }
            String completionLabel = "跳过：";
            if (result.shouldApply()) {
                completionLabel = DeliveryStatus.WAITING_CONFIRM + "：";
            } else if (result.isProviderOutcomeUnknown()) {
                completionLabel = "结果未知：";
            } else if (failed) {
                completionLabel = DeliveryStatus.AI_ANALYSIS_FAILED + "：";
            }
            emit(progress, JobProgressMessage.progress(
                    platform, completionLabel + jobName, current, total));
        } catch (Exception e) {
            log.warn("Chrome 后台 AI 分析任务 {} 失败: {}", taskId, e.getMessage(), e);
            if (claimed != null) {
                finishAfterExecutionException(claimed, leaseToken, request, e);
            }
        } finally {
            if (heartbeat != null) heartbeat.cancel(false);
            runtimeJobs.remove(taskId);
            locallyScheduledTaskIds.remove(taskId);
            dispatchPendingTasks();
        }
    }

    private ScheduledFuture<?> startLeaseHeartbeat(long taskId, String leaseToken) {
        return leaseHeartbeatExecutor.scheduleAtFixedRate(() -> {
            try {
                if (!taskStore.renewLease(taskId, leaseToken, LEASE_DURATION)) {
                    log.warn("AI 任务 {} 的租约续期被拒绝，旧执行结果将被租约校验丢弃", taskId);
                }
            } catch (Exception e) {
                log.warn("AI 任务 {} 的租约续期失败: {}", taskId, e.getMessage());
            }
        }, LEASE_HEARTBEAT_SECONDS, LEASE_HEARTBEAT_SECONDS, TimeUnit.SECONDS);
    }

    private void finishAfterExecutionException(JobAnalysisTaskStore.TaskRecord task,
                                               String leaseToken,
                                               JobAiAnalysisService.JobAnalysisRequest request,
                                               Exception error) {
        String message = firstNonBlank(error.getMessage(), "AI 分析执行异常");
        try {
            JobAiAnalysisService.JobAnalysisRequest recoverableRequest = request == null
                    ? taskStore.deserialize(task)
                    : request;
            JobAiAnalysisService.PlatformAnalysisState platformState =
                    jobAiAnalysisService.inspectPlatformAnalysis(recoverableRequest);
            if (platformState.completed()) {
                boolean failed = platformState.failed();
                if (!taskStore.complete(task.id(), leaseToken, failed,
                        "执行异常后已从平台结果对账：" + platformState.status())) {
                    taskStore.reconcileUnknown(
                            task.id(), leaseToken,
                            failed ? JobAnalysisTaskStore.Status.FAILED : JobAnalysisTaskStore.Status.SUCCEEDED,
                            "执行异常后已从平台结果对账：" + platformState.status()
                    );
                }
                return;
            }

            boolean platformWriteAllowed = taskStore.executeWithLease(
                    task.id(), leaseToken,
                    () -> jobAiAnalysisService.markAnalysisInterrupted(recoverableRequest, message)
            );
            if (!platformWriteAllowed) return;
            boolean failed = taskStore.complete(task.id(), leaseToken, true, message);
            if (!failed) {
                taskStore.reconcileUnknown(
                        task.id(), leaseToken, JobAnalysisTaskStore.Status.FAILED, message);
            }
        } catch (Exception recoveryError) {
            log.error("AI 任务 {} 的异常恢复失败，将保留租约等待过期对账: {}",
                    task.id(), recoveryError.getMessage(), recoveryError);
        }
    }

    private void reconcileExpiredLease(JobAnalysisTaskStore.TaskRecord task) {
        try {
            JobAiAnalysisService.JobAnalysisRequest request = taskStore.deserialize(task);
            JobAiAnalysisService.PlatformAnalysisState platformState =
                    jobAiAnalysisService.inspectPlatformAnalysis(request);
            if (platformState.completed()) {
                JobAnalysisTaskStore.Status target = platformState.failed()
                        ? JobAnalysisTaskStore.Status.FAILED
                        : JobAnalysisTaskStore.Status.SUCCEEDED;
                taskStore.reconcileExpired(
                        task.id(), task.leaseOwner(), target,
                        "启动恢复已从平台结果对账：" + platformState.status()
                );
                return;
            }

            String reason = "AI 请求执行结果未知，已停止自动重试；请人工确认后显式重试";
            taskStore.reconcileExpired(
                    task.id(), task.leaseOwner(), JobAnalysisTaskStore.Status.UNKNOWN, reason,
                    () -> jobAiAnalysisService.markAnalysisInterrupted(request, reason)
            );
        } catch (Exception e) {
            String reason = "AI 任务恢复失败，已停止自动重试：" + firstNonBlank(e.getMessage(), "未知错误");
            taskStore.reconcileExpired(
                    task.id(), task.leaseOwner(), JobAnalysisTaskStore.Status.UNKNOWN, reason);
            log.warn("恢复过期 AI 任务 {} 失败: {}", task.id(), e.getMessage(), e);
        }
    }

    private void reconcileLateWorkerResult(JobAnalysisTaskStore.TaskRecord task,
                                           String leaseToken,
                                           boolean failed,
                                           String message) {
        JobAnalysisTaskStore.Status target = failed
                ? JobAnalysisTaskStore.Status.FAILED
                : JobAnalysisTaskStore.Status.SUCCEEDED;
        taskStore.reconcileUnknown(
                task.id(), leaseToken, target,
                "过期执行器结果已完成对账：" + firstNonBlank(message, target.name())
        );
    }

    private void emit(Consumer<JobProgressMessage> progress, JobProgressMessage message) {
        if (progress == null || message == null) return;
        try {
            progress.accept(message);
        } catch (Exception e) {
            log.debug("发送后台 AI 分析进度失败: {}", e.getMessage());
        }
    }

    private String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String value : values) {
            if (value != null && !value.isBlank()) return value.trim();
        }
        return "";
    }

    @PreDestroy
    public void shutdown() {
        stopping = true;
        leaseHeartbeatExecutor.shutdownNow();
        executor.shutdown();
        try {
            if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }

    @Data
    public static class AnalysisJob {
        private String runId;
        private String currentStatus;
        private int current;
        private int total;
        private JobAiAnalysisService.JobAnalysisRequest request;
        private Consumer<JobProgressMessage> progressCallback;
    }

    @Data
    @RequiredArgsConstructor(staticName = "of")
    public static class EnqueueResult {
        private final boolean queued;
        private final boolean rejected;
        private final String message;
        private final int queueSize;

        public static EnqueueResult queued(int queueSize) {
            return EnqueueResult.of(true, false, "", queueSize);
        }

        public static EnqueueResult skipped(String message) {
            return EnqueueResult.of(false, false, message, 0);
        }

        public static EnqueueResult rejected(String message) {
            return EnqueueResult.of(false, true, message, 0);
        }
    }

    public record QueueHealth(boolean accepting,
                              boolean stopping,
                              int outstandingTasks,
                              int activeWorkers,
                              int localQueueSize,
                              int remainingLocalCapacity) {
    }

    private static class NamedThreadFactory implements ThreadFactory {
        private final AtomicInteger index = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "Chrome-AI-Analysis-" + index.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }

    private static class LeaseHeartbeatThreadFactory implements ThreadFactory {
        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "Chrome-AI-Lease-Heartbeat");
            thread.setDaemon(true);
            return thread;
        }
    }
}
