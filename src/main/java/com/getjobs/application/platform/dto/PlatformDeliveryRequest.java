package com.getjobs.application.platform.dto;

import lombok.Data;

import java.util.Map;

@Data
public class PlatformDeliveryRequest {
    private Long jobId;
    private String scanRunId;
    private Map<String, Object> metadata;
}
