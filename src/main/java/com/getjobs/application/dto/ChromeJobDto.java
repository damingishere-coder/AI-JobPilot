package com.getjobs.application.dto;

import lombok.Data;

import java.util.List;

@Data
public class ChromeJobDto {
    private String id;
    private String userId;
    private String title;
    private String company;
    private String salary;
    private String location;
    private String experience;
    private String degree;
    private String hrName;
    private String hrTitle;
    private String hrActive;
    private String description;
    private String deliveryStatus;
    private String url;
    private String recruitmentStatus;
    private String companyAddress;
    private String industry;
    private String companyInfo;
    private String financingStage;
    private String companyScale;
    private String keyword;
    private String source;
    private String salarySource;
    private String securityId;
    private String lid;
    private String encryptBossId;
    private String encryptBrandId;
    private List<String> skills;
    private List<String> welfare;
}
