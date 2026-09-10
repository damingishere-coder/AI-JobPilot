package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("resume_profile")
public class ResumeProfileEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("profile_id")
    private Long profileId;

    @TableField("resume_text")
    private String resumeText;

    @TableField("source_filename")
    private String sourceFilename;

    @TableField("parse_status")
    private String parseStatus;

    @TableField("parse_message")
    private String parseMessage;

    @TableField("recommended_job_keywords")
    private String recommendedJobKeywords;

    @TableField("created_at")
    private LocalDateTime createdAt;

    @TableField("updated_at")
    private LocalDateTime updatedAt;
}
