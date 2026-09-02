package com.getjobs.application.dto;

import lombok.Data;

import java.util.List;

@Data
public class ResumeSaveRequest {
    private String resumeText;
    private String sourceFilename;
    private String parseMethod;
    private Integer qualityScore;
    private List<String> warnings;
}
