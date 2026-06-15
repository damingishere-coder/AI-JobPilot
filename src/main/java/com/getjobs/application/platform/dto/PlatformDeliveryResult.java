package com.getjobs.application.platform.dto;

import lombok.Data;

import java.util.Map;

@Data
public class PlatformDeliveryResult {
    private boolean success;
    private String platform;
    private Long jobId;
    private String message;
    private Map<String, Object> task;

    public static PlatformDeliveryResult ok(String platform, Long jobId, String message, Map<String, Object> task) {
        PlatformDeliveryResult result = new PlatformDeliveryResult();
        result.setSuccess(true);
        result.setPlatform(platform);
        result.setJobId(jobId);
        result.setMessage(message);
        result.setTask(task);
        return result;
    }

    public static PlatformDeliveryResult failed(String platform, Long jobId, String message) {
        PlatformDeliveryResult result = new PlatformDeliveryResult();
        result.setSuccess(false);
        result.setPlatform(platform);
        result.setJobId(jobId);
        result.setMessage(message);
        return result;
    }
}
