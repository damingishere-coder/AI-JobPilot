package com.getjobs.application.platform;

import com.getjobs.application.platform.dto.PlatformDeliveryRequest;
import com.getjobs.application.platform.dto.PlatformDeliveryResult;
import com.getjobs.application.platform.dto.PlatformJobItem;
import com.getjobs.application.platform.dto.PlatformScanRequest;

import java.util.List;

public interface PlatformAdapter {
    String platform();

    List<PlatformJobItem> scan(PlatformScanRequest request);

    PlatformDeliveryResult deliver(PlatformDeliveryRequest request);
}
