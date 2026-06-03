package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("priority_company")
public class PriorityCompanyEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("profile_id")
    private Long profileId;

    @TableField("company_name")
    private String companyName;

    @TableField("enabled")
    private Integer enabled;

    @TableField("remark")
    private String remark;

    @TableField("created_at")
    private LocalDateTime createdAt;

    @TableField("updated_at")
    private LocalDateTime updatedAt;
}
