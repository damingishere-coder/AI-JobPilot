package com.getjobs.application.dto;

import lombok.Data;

@Data
public class DeliveryResultRequest {
    private Boolean success;
    private String message;
    private String failureType;
    private String failureReason;
}
