package com.getjobs.application.dto;

import lombok.Data;

import java.util.List;

@Data
public class ConfirmBatchRequest {
    private List<Long> ids;
    private String statuses;
    private String location;
    private String experience;
    private String degree;
    private Double minK;
    private Double maxK;
    private Integer minAiScore;
    private String keyword;
    private String scanRunId;
    private Boolean filterHeadhunter;
    private Boolean aiRecommendedOnly;
    private Boolean manualOverrideAiNotMatch;
}
