package com.getjobs.application.platform;

import com.getjobs.application.platform.dto.PlatformDeliveryRequest;
import com.getjobs.application.platform.dto.PlatformDeliveryResult;
import com.getjobs.application.platform.dto.PlatformJobItem;
import com.getjobs.application.platform.dto.PlatformScanRequest;

import java.util.List;

public interface PlatformAdapter {
    String platform();

    PlatformCapability capability();

    default String normalizeJobKey(Object rawJobKey) {
        if (rawJobKey == null) {
            throw new IllegalArgumentException("岗位标识不能为空");
        }
        String normalized = rawJobKey.toString().trim();
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("岗位标识不能为空");
        }
        return normalized;
    }

    PlatformAnalysisInput toAnalysisInput(Long jobId, Long profileId);

    List<PlatformJobItem> scan(PlatformScanRequest request);

    PlatformDeliveryResult deliver(PlatformDeliveryRequest request);
}
