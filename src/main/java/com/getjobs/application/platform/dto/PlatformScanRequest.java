package com.getjobs.application.platform.dto;

import lombok.Data;

import java.util.List;

@Data
public class PlatformScanRequest {
    private List<String> statuses;
    private String location;
    private String experience;
    private String degree;
    private Double minK;
    private Double maxK;
    private String keyword;
    private String scanRunId;
    private Boolean filterHeadhunter;
    private Integer page;
    private Integer size;
}
