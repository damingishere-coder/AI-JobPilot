package com.getjobs.application.dto;

import com.fasterxml.jackson.annotation.JsonAnySetter;
import lombok.Data;
import java.util.ArrayList;
import java.util.List;

/** Official Zhilian codes, not BOSS codes. Empty values mean no restriction. */
@Data
public class ZhilianFilters {
    private String district = "";
    private String subwayLine = "";
    private String subwayStation = "";
    private List<String> education = new ArrayList<>();
    private List<String> experience = new ArrayList<>();
    private List<String> companyType = new ArrayList<>();
    private List<String> financing = new ArrayList<>();
    private List<String> companySize = new ArrayList<>();
    private List<String> workNature = new ArrayList<>();
    private String jobCategory = "";
    private List<String> industry = new ArrayList<>();

    @com.fasterxml.jackson.annotation.JsonIgnore
    public boolean isActive() {
        return java.util.stream.Stream.of(district,subwayLine,subwayStation,jobCategory).anyMatch(v->v!=null&&!v.isBlank())
                || java.util.stream.Stream.of(education,experience,companyType,financing,companySize,workNature,industry).anyMatch(v->v!=null&&!v.isEmpty());
    }

    @JsonAnySetter
    public void rejectUnknown(String name, Object value) {
        throw new IllegalArgumentException("不支持的智联筛选字段：" + name);
    }
}
