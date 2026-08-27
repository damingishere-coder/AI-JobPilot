package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("job_greeting_draft")
public class JobGreetingDraftEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("profile_id")
    private Long profileId;

    private String platform;

    @TableField("job_key")
    private String jobKey;

    private String content;
    private Integer version;

    @TableField("created_at")
    private LocalDateTime createdAt;

    @TableField("updated_at")
    private LocalDateTime updatedAt;
}
