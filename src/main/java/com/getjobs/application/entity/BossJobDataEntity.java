package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * boss_data 表实体
 */
@Data
@TableName("boss_data")
public class BossJobDataEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("profile_id")
    private Long profileId;

    @TableField("encrypt_id")
    private String encryptId;

    @TableField("encrypt_user_id")
    private String encryptUserId;

    @TableField("company_name")
    private String companyName;

    @TableField("job_name")
    private String jobName;

    @TableField("salary")
    private String salary;

    @TableField("salary_min_k")
    private Double salaryMinK;

    @TableField("salary_max_k")
    private Double salaryMaxK;

    @TableField("salary_median_k")
    private Double salaryMedianK;

    @TableField("salary_months")
    private Integer salaryMonths;

    @TableField("location")
    private String location;

    @TableField("experience")
    private String experience;

    @TableField("degree")
    private String degree;

    @TableField("hr_name")
    private String hrName;

    @TableField("hr_position")
    private String hrPosition;

    @TableField("hr_active_status")
    private String hrActiveStatus;

    @TableField("delivery_status")
    private String deliveryStatus; // 默认 未投递 / 已投递 / 已过滤 / 投递失败

    @TableField("failure_type")
    private String failureType;

    @TableField("failure_reason")
    private String failureReason;

    @TableField("job_description")
    private String jobDescription;

    @TableField("job_url")
    private String jobUrl;

    @TableField("recruitment_status")
    private String recruitmentStatus;

    @TableField("company_address")
    private String companyAddress;

    @TableField("industry")
    private String industry;

    @TableField("introduce")
    private String introduce;

    @TableField("financing_stage")
    private String financingStage;

    @TableField("company_scale")
    private String companyScale;

    @TableField("source_keyword")
    private String sourceKeyword;

    @TableField("scan_run_id")
    private String scanRunId;

    @TableField("ai_score")
    private Integer aiScore;

    @TableField("ai_decision")
    private String aiDecision;

    @TableField("ai_reason")
    private String aiReason;

    @TableField("priority_company")
    private Integer priorityCompany;

    @TableField("created_at")
    private LocalDateTime createdAt;

    @TableField("updated_at")
    private LocalDateTime updatedAt;
}
