package com.getjobs.application.service;

import java.util.Set;

public final class DeliveryStatus {
    public static final String NOT_DELIVERED = "未投递";
    public static final String WAITING_CONFIRM = "待确认";
    public static final String AI_ANALYZING = "AI分析中";
    public static final String AI_NOT_MATCH = "AI不匹配";
    public static final String AI_ANALYSIS_FAILED = "AI分析失败";
    public static final String COLLECTION_INSUFFICIENT = "采集信息不足";
    public static final String LIST_COLLECTED = "LIST_COLLECTED";
    public static final String SKIPPED = "已跳过";
    public static final String DELIVERED = "已投递";
    public static final String DELIVERY_FAILED = "投递失败";
    public static final String FILTERED = "已过滤";
    public static final String UNKNOWN_FAILURE_TYPE = "UNKNOWN_ERROR";

    public static final Set<String> CHROME_ACCEPTED_STATUSES = Set.of(
            DELIVERED,
            WAITING_CONFIRM,
            SKIPPED,
            AI_ANALYZING,
            AI_NOT_MATCH,
            AI_ANALYSIS_FAILED,
            COLLECTION_INSUFFICIENT,
            LIST_COLLECTED,
            DELIVERY_FAILED
    );

    public static final Set<String> FINAL_STATUSES = Set.of(
            WAITING_CONFIRM,
            DELIVERED,
            SKIPPED,
            AI_NOT_MATCH,
            AI_ANALYSIS_FAILED,
            COLLECTION_INSUFFICIENT,
            DELIVERY_FAILED
    );

    private DeliveryStatus() {
    }

    public static String normalizeChromeStatus(String status) {
        if (status == null || status.isBlank()) return NOT_DELIVERED;
        String value = status.trim();
        return CHROME_ACCEPTED_STATUSES.contains(value) ? value : NOT_DELIVERED;
    }

    public static boolean isFinalStatus(String status) {
        return status != null && FINAL_STATUSES.contains(status.trim());
    }

    public static boolean isDelivered(String status) {
        return DELIVERED.equals(trim(status));
    }

    public static boolean isWaitingConfirm(String status) {
        return WAITING_CONFIRM.equals(trim(status));
    }

    public static boolean isDeliveryFailed(String status) {
        return DELIVERY_FAILED.equals(trim(status));
    }

    public static String fromAiResult(JobAiAnalysisService.AnalysisResult result) {
        if (result == null) return AI_ANALYSIS_FAILED;
        if (result.isFailure()) return AI_ANALYSIS_FAILED;
        return result.shouldApply() ? WAITING_CONFIRM : AI_NOT_MATCH;
    }

    public static String protectDelivered(String currentStatus, String nextStatus) {
        return isDelivered(currentStatus) ? DELIVERED : nextStatus;
    }

    public static String defaultIfBlank(String status) {
        return status == null || status.isBlank() ? NOT_DELIVERED : status;
    }

    private static String trim(String status) {
        return status == null ? null : status.trim();
    }
}
