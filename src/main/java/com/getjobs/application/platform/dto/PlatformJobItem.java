package com.getjobs.application.platform.dto;

import lombok.Data;

@Data
public class PlatformJobItem {
    private Long id;
    private String platform;
    private String companyName;
    private String jobName;
    private String salary;
    private String location;
    private String experience;
    private String degree;
    private String jobUrl;
    private String deliveryStatus;
    private String scanRunId;
    private Integer aiScore;
    private String aiDecision;
}
