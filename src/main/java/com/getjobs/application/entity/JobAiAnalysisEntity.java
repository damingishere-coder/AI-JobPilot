package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("job_ai_analysis")
public class JobAiAnalysisEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("profile_id")
    private Long profileId;

    @TableField("platform")
    private String platform;

    @TableField("job_key")
    private String jobKey;

    @TableField("company_name")
    private String companyName;

    @TableField("job_name")
    private String jobName;

    @TableField("scan_run_id")
    private String scanRunId;

    @TableField("score")
    private Integer score;

    @TableField("decision")
    private String decision;

    @TableField("summary")
    private String summary;

    @TableField("strengths")
    private String strengths;

    @TableField("risks")
    private String risks;

    @TableField("greeting")
    private String greeting;

    @TableField("priority_company")
    private Integer priorityCompany;

    @TableField("raw_response")
    private String rawResponse;

    @TableField("created_at")
    private LocalDateTime createdAt;

    @TableField("updated_at")
    private LocalDateTime updatedAt;
}
