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

    @TableField("resume_text")
    private String resumeText;

    @TableField("source_filename")
    private String sourceFilename;

    @TableField("parse_status")
    private String parseStatus;

    @TableField("parse_message")
    private String parseMessage;

    @TableField("created_at")
    private LocalDateTime createdAt;

    @TableField("updated_at")
    private LocalDateTime updatedAt;
}
