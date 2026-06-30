package com.getjobs.application.dto;

import lombok.Data;

import java.util.List;

@Data
public class ChromeJobBatchRequest {
    private String runId;
    private String keyword;
    private String collectionMode;
    private Boolean autoDeliver;
    private List<ChromeJobDto> jobs;
}
