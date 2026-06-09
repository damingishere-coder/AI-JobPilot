package com.getjobs.application.service;

import com.getjobs.worker.dto.JobProgressMessage;
import jakarta.annotation.PreDestroy;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;

@Slf4j
@Service
public class ChromeJobAnalysisQueueService {
    private static final int AI_CONCURRENCY = 2;
    private static final int QUEUE_CAPACITY = 200;
    private static final long COMPLETED_KEY_TTL_MS = TimeUnit.MINUTES.toMillis(30);

    private final JobAiAnalysisService jobAiAnalysisService;
    private final ThreadPoolExecutor executor;
    private final java.util.Set<String> activeKeys = ConcurrentHashMap.newKeySet();
    private final Map<String, Long> completedKeys = new ConcurrentHashMap<>();

    public ChromeJobAnalysisQueueService(JobAiAnalysisService jobAiAnalysisService) {
        this.jobAiAnalysisService = jobAiAnalysisService;
        this.executor = new ThreadPoolExecutor(
                AI_CONCURRENCY,
                AI_CONCURRENCY,
                60L,
                TimeUnit.SECONDS,
                new ArrayBlockingQueue<>(QUEUE_CAPACITY),
                new NamedThreadFactory(),
                new ThreadPoolExecutor.AbortPolicy()
        );
        this.executor.allowCoreThreadTimeOut(false);
    }

    public EnqueueResult enqueue(AnalysisJob job) {
        if (job == null || job.getRequest() == null) {
            return EnqueueResult.skipped("分析任务为空");
        }
        purgeCompletedKeys();

        if (isFinalStatus(job.getCurrentStatus())) {
            return EnqueueResult.skipped("岗位已完成AI分析或投递处理");
        }

        String dedupeKey = dedupeKey(job);
        if (completedKeys.containsKey(dedupeKey) || !activeKeys.add(dedupeKey)) {
            return EnqueueResult.skipped("重复AI分析任务");
        }

        try {
            executor.execute(() -> runAnalysis(job, dedupeKey));
            return EnqueueResult.queued(queueSize());
        } catch (RejectedExecutionException e) {
            activeKeys.remove(dedupeKey);
            return EnqueueResult.rejected("AI分析队列已满，请稍后再试");
        }
    }

    public int queueSize() {
        return executor.getQueue().size() + executor.getActiveCount();
    }

    private void runAnalysis(AnalysisJob job, String dedupeKey) {
        JobAiAnalysisService.JobAnalysisRequest request = job.getRequest();
        Consumer<JobProgressMessage> progress = job.getProgressCallback();
        String platform = Objects.toString(request.getPlatform(), "");
        String jobName = Objects.toString(request.getJobName(), "");

        try {
            emit(progress, JobProgressMessage.progress(
                    platform,
                    "AI分析中：" + jobName,
                    job.getCurrent(),
                    job.getTotal()
            ));
            JobAiAnalysisService.AnalysisResult result = jobAiAnalysisService.analyzeJob(request);

            if (result.isFailure()) {
                emit(progress, JobProgressMessage.warning(
                        platform,
                        "AI分析失败：" + jobName + "，" + Objects.toString(result.getSummary(), "")
                ));
            }

            emit(progress, JobProgressMessage.progress(
                    platform,
                    (result.shouldApply() ? DeliveryStatus.WAITING_CONFIRM + "：" : result.isFailure() ? DeliveryStatus.AI_ANALYSIS_FAILED + "：" : "跳过：") + jobName,
                    job.getCurrent(),
                    job.getTotal()
            ));
        } catch (Exception e) {
            log.warn("{} Chrome后台AI分析任务失败: {}", platform, e.getMessage(), e);
            emit(progress, JobProgressMessage.warning(
                    platform,
                    "AI分析失败：" + jobName + "，" + e.getMessage()
            ));
        } finally {
            activeKeys.remove(dedupeKey);
            completedKeys.put(dedupeKey, System.currentTimeMillis());
        }
    }

    private void emit(Consumer<JobProgressMessage> progress, JobProgressMessage message) {
        if (progress == null || message == null) return;
        try {
            progress.accept(message);
        } catch (Exception e) {
            log.debug("发送后台AI分析进度失败: {}", e.getMessage());
        }
    }

    private boolean isFinalStatus(String status) {
        return DeliveryStatus.isFinalStatus(status);
    }

    private String dedupeKey(AnalysisJob job) {
        JobAiAnalysisService.JobAnalysisRequest request = job.getRequest();
        String runId = Objects.toString(job.getRunId(), "no-run");
        String platform = Objects.toString(request.getPlatform(), "");
        String jobKey = firstNonBlank(
                request.getJobKey(),
                request.getCompanyName() + "::" + request.getJobName()
        );
        return runId + "::" + platform + "::" + jobKey;
    }

    private String firstNonBlank(String... values) {
        if (values == null) return "";
        for (String value : values) {
            if (value != null && !value.isBlank()) return value.trim();
        }
        return "";
    }

    private void purgeCompletedKeys() {
        long cutoff = System.currentTimeMillis() - COMPLETED_KEY_TTL_MS;
        completedKeys.entrySet().removeIf(entry -> entry.getValue() == null || entry.getValue() < cutoff);
    }

    @PreDestroy
    public void shutdown() {
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

    private static class NamedThreadFactory implements ThreadFactory {
        private final AtomicInteger index = new AtomicInteger(1);

        @Override
        public Thread newThread(Runnable runnable) {
            Thread thread = new Thread(runnable, "Chrome-AI-Analysis-" + index.getAndIncrement());
            thread.setDaemon(true);
            return thread;
        }
    }
}
