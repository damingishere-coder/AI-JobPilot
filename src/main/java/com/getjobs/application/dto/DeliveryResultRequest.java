package com.getjobs.application.dto;

import lombok.Data;

@Data
public class DeliveryResultRequest {
    /** 仅作旧扩展兼容；新调用方应使用 outcome。 */
    private Boolean success;
    private String requestKey;
    private String outcome;
    private String evidence;
    private String message;
    private String failureType;
    private String failureReason;
}
