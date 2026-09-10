package com.getjobs.application.controller;

import com.getjobs.application.platform.PlatformAdapter;
import com.getjobs.application.platform.PlatformAdapterRegistry;
import com.getjobs.application.platform.PlatformAnalysisInput;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.ProfileService;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.util.LinkedHashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/platforms/{platform}/jobs")
@RequiredArgsConstructor
public class PlatformAnalysisController {
    private final PlatformAdapterRegistry platformAdapterRegistry;
    private final ProfileService profileService;
    private final ChromeJobAnalysisQueueService analysisQueueService;

    @PostMapping("/{jobId}/analyze")
    public ResponseEntity<Map<String, Object>> analyze(@PathVariable String platform,
                                                       @PathVariable Long jobId) {
        try {
            PlatformAdapter adapter = platformAdapterRegistry.required(platform);
            if (!adapter.capability().analysisSupported()) {
                return ResponseEntity.status(HttpStatus.CONFLICT)
                        .body(Map.of("success", false, "message", "该平台尚未支持统一 AI 分析"));
            }
            PlatformAnalysisInput input = adapter.toAnalysisInput(jobId, profileService.getCurrentProfileId());
            ChromeJobAnalysisQueueService.AnalysisJob job = new ChromeJobAnalysisQueueService.AnalysisJob();
            job.setRunId(input.request().getScanRunId());
            job.setCurrentStatus(input.currentStatus());
            job.setCurrent(1);
            job.setTotal(1);
            job.setRequest(input.request());
            ChromeJobAnalysisQueueService.EnqueueResult result = analysisQueueService.enqueue(job);
            Map<String, Object> response = new LinkedHashMap<>();
            response.put("success", !result.isRejected());
            response.put("queued", result.isQueued());
            response.put("platform", adapter.platform());
            response.put("jobId", jobId);
            response.put("jobKey", input.request().getJobKey());
            response.put("profileId", input.request().getProfileId());
            response.put("runId", input.request().getScanRunId() == null ? "" : input.request().getScanRunId());
            response.put("queueSize", result.getQueueSize());
            response.put("message", result.getMessage() == null ? "" : result.getMessage());
            return result.isRejected()
                    ? ResponseEntity.status(HttpStatus.TOO_MANY_REQUESTS).body(response)
                    : ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            return ResponseEntity.badRequest().body(Map.of("success", false, "message", e.getMessage()));
        }
    }
}
