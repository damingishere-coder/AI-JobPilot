package com.getjobs.application.service;

import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.util.*;
import java.util.function.Function;

/** Durable collection ownership, independent of AI outcome and browser acknowledgements. */
@Service
@RequiredArgsConstructor
public class FreshScanReceiptService {
    private final JdbcTemplate jdbc;

    public synchronized ResponseEntity<Map<String, Object>> submit(String platform, ChromeJobBatchRequest request,
            Function<ChromeJobBatchRequest, ResponseEntity<Map<String, Object>>> receiver) {
        if (request.getRunId() == null || request.getRunId().isBlank() || request.getKeyword() == null) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", "新岗位采集缺少任务或关键词"));
        }
        List<Map<String, Object>> items = new ArrayList<>();
        for (ChromeJobDto job : request.getJobs() == null ? List.<ChromeJobDto>of() : request.getJobs()) {
            String key = key(job);
            if (key.isBlank()) { items.add(item(key, "INSUFFICIENT", false, false, "缺少稳定岗位ID", "JOB_ID_MISSING")); continue; }
            var rows = jdbc.queryForList("SELECT * FROM fresh_scan_receipt WHERE profile_id=? AND platform=? AND scan_run_id=? AND job_key=?",
                    request.getProfileId(), platform, request.getRunId(), key);
            if (rows.isEmpty()) {
                boolean eligible = !exists(platform, request.getProfileId(), key);
                jdbc.update("INSERT OR IGNORE INTO fresh_scan_receipt(profile_id,platform,scan_run_id,job_key,keyword,eligible) VALUES(?,?,?,?,?,?)",
                        request.getProfileId(), platform, request.getRunId(), key, request.getKeyword(), eligible ? 1 : 0);
                rows = jdbc.queryForList("SELECT * FROM fresh_scan_receipt WHERE profile_id=? AND platform=? AND scan_run_id=? AND job_key=?",
                        request.getProfileId(), platform, request.getRunId(), key);
            }
            var row = rows.getFirst();
            boolean owned = request.getKeyword().equals(row.get("keyword"));
            if (((Number) row.get("eligible")).intValue() == 0 || !owned) {
                items.add(item(key, "SKIPPED", false, false, "历史或本轮其他关键词已收录，不占目标", "")); continue;
            }
            // A task remains evidence of acceptance even after AI finishes or fails.
            if (((Number) row.get("accepted")).intValue() == 1 || taskAccepted(platform, request, key)) {
                markAccepted(platform, request, key);
                items.add(item(key, "EXISTING", true, false, "本关键词入队回执已恢复", "")); continue;
            }
            if (!Boolean.TRUE.equals(job.getDetailVerified()) || Boolean.TRUE.equals(job.getDetailNavigationFailed())
                    || job.getDescription() == null || job.getDescription().trim().length() < 30) {
                items.add(item(key, "INSUFFICIENT", false, false, "详情尚未完整核验，不占目标", "DETAIL_NOT_VERIFIED")); continue;
            }
            ChromeJobBatchRequest one = new ChromeJobBatchRequest();
            one.setProfileId(request.getProfileId()); one.setRunId(request.getRunId());
            one.setKeyword(request.getKeyword()); one.setJobs(List.of(job)); one.setAutoDeliver(false);
            var response = receiver.apply(one);
            var body = response.getBody() == null ? Map.<String, Object>of() : response.getBody();
            if (Boolean.TRUE.equals(body.get("cancelled"))) return ResponseEntity.ok(Map.of("success", true, "cancelled", true, "items", items));
            if (taskAccepted(platform, request, key)) {
                markAccepted(platform, request, key);
                items.add(item(key, "QUEUED", true, false, "新岗位已加入分析队列", ""));
            } else if (response.getStatusCode().value() == 409 || response.getStatusCode().value() == 400) {
                return response;
            } else {
                Map<?, ?> nativeItem = body.get("items") instanceof List<?> list && !list.isEmpty() && list.getFirst() instanceof Map<?, ?> m ? m : Map.of();
                if (nativeItem.isEmpty() && body.get("rejected") instanceof List<?> rejectedItems
                        && !rejectedItems.isEmpty() && rejectedItems.getFirst() instanceof Map<?, ?> rejectedItem) nativeItem = rejectedItem;
                String status = Objects.toString(nativeItem.get("status"), "");
                boolean insufficient = "INSUFFICIENT".equals(status) || number(body.get("insufficient")) > 0;
                boolean retryable = Boolean.TRUE.equals(nativeItem.get("retryable"))
                        && Set.of("QUEUE_FULL", "DB_BUSY").contains(Objects.toString(nativeItem.get("errorCode"), ""));
                items.add(item(key, insufficient ? "INSUFFICIENT" : retryable ? "REJECTED" : "FAILED", false, retryable,
                        Objects.toString(body.get("message"), "岗位未进入分析队列"), Objects.toString(nativeItem.get("errorCode"), "")));
            }
        }
        long accepted = items.stream().filter(i -> Boolean.TRUE.equals(i.get("freshAccepted"))).count();
        Map<String, Object> result = new HashMap<>();
        result.put("success", true); result.put("items", items); result.put("received", items.size());
        result.put("saved", accepted); result.put("queued", accepted); result.put("freshAccepted", accepted);
        result.put("skipped", items.stream().filter(i -> "SKIPPED".equals(i.get("status"))).count());
        result.put("insufficient", items.stream().filter(i -> "INSUFFICIENT".equals(i.get("status"))).count());
        result.put("restored", 0); result.put("asyncAnalysis", true);
        return ResponseEntity.ok(result);
    }

    public boolean exists(String platform, long profileId, String key) {
        String table = "boss".equals(platform) ? "boss_data" : "zhilian".equals(platform) ? "zhilian_data" : null;
        if (table == null) throw new IllegalArgumentException("Unsupported platform");
        String column = "boss".equals(platform) ? "encrypt_id" : "job_id";
        return number(jdbc.queryForObject("SELECT COUNT(*) FROM " + table + " WHERE profile_id=? AND TRIM(" + column + ")=TRIM(?)", Integer.class, profileId, key)) > 0;
    }
    private boolean taskAccepted(String platform, ChromeJobBatchRequest r, String key) {
        return number(jdbc.queryForObject("SELECT COUNT(*) FROM job_analysis_task WHERE profile_id=? AND platform=? AND scan_run_id=? AND job_key=?",
                Integer.class, r.getProfileId(), platform, r.getRunId(), key)) > 0;
    }
    private void markAccepted(String platform, ChromeJobBatchRequest r, String key) {
        jdbc.update("UPDATE fresh_scan_receipt SET accepted=1,updated_at=CURRENT_TIMESTAMP WHERE profile_id=? AND platform=? AND scan_run_id=? AND job_key=?",
                r.getProfileId(), platform, r.getRunId(), key);
    }
    private static int number(Object n) { return n instanceof Number v ? v.intValue() : 0; }
    public static String key(ChromeJobDto job) {
        if (job == null) return "";
        if (job.getId() != null && !job.getId().isBlank()) return job.getId().trim();
        try { String path = URI.create(job.getUrl()).getPath(); return path.substring(path.lastIndexOf('/') + 1).replaceFirst("\\.html?$", ""); }
        catch (Exception ignored) { return ""; }
    }
    private static Map<String, Object> item(String key, String status, boolean accepted, boolean retryable, String message, String code) {
        return Map.of("jobKey", key, "status", status, "freshAccepted", accepted, "retryable", retryable, "message", message, "errorCode", code);
    }
}
