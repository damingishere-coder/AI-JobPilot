package com.getjobs.application.platform;

import com.getjobs.application.service.JobAiAnalysisService;

public record PlatformAnalysisInput(
        JobAiAnalysisService.JobAnalysisRequest request,
        String currentStatus
) {
}
