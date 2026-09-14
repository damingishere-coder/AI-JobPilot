package com.getjobs.application.service;

import java.util.*;
import java.util.function.Supplier;

/** One analysis batch's logical calls. Transport retries remain bounded inside AiService. */
final class AiAnalysisCallLedger {
    enum Purpose { MATCH_BATCH, BATCH_FORMAT_REPAIR, SINGLE_FORMAT_REPAIR, GREETING_REPAIR }
    private final Set<Long> taskIds;
    private final Set<String> used = new HashSet<>();
    private final List<Map<String, Object>> calls = new ArrayList<>();

    AiAnalysisCallLedger(Collection<Long> taskIds) { this.taskIds = Set.copyOf(taskIds); }

    String invoke(Purpose purpose, Long taskId, Supplier<String> action) {
        boolean perJob = purpose == Purpose.SINGLE_FORMAT_REPAIR || purpose == Purpose.GREETING_REPAIR;
        if (perJob && !taskIds.contains(taskId)) throw new IllegalArgumentException("分析调用缺少批次内任务身份");
        String key = purpose.name() + (perJob ? ":" + taskId : "");
        if (calls.size() >= 2 + taskIds.size() * 2 || !used.add(key)) {
            throw new IllegalStateException("AI 分析调用预算已用尽，不再自动调用");
        }
        Map<String, Object> call = new LinkedHashMap<>();
        call.put("sequence", calls.size() + 1); call.put("purpose", purpose.name());
        if (perJob) call.put("taskId", taskId);
        calls.add(call);
        try {
            String result = action.get();
            // Response receipt is distinct from schema/business validity.
            call.put("outcome", "RESPONSE_RECEIVED");
            return result;
        } catch (AiProviderException error) {
            call.put("outcome", error.isOutcomeUnknown() ? "UNKNOWN" : "FAILED");
            call.put("errorCode", error.getCode().name());
            if (error.getClientRequestId() != null) call.put("clientRequestId", error.getClientRequestId());
            throw error;
        } catch (RuntimeException error) {
            call.put("outcome", "FAILED");
            throw error;
        }
    }

    List<Map<String, Object>> snapshot() { return calls.stream().map(Map::copyOf).toList(); }
}
