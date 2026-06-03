package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

@Data
@TableName("zhilian_config")
public class ZhilianConfigEntity {
    @TableId(type = IdType.AUTO)
    /** 主键ID */
    private Long id;

    /** 所属人物档案ID */
    @TableField("profile_id")
    private Long profileId;

    /** 搜索关键词（逗号或括号列表，例如 "[Java,后端]" 或 "Java,后端"） */
    private String keywords;

    /** 城市（中文名或代码，单值） */
    private String cityCode;

    /** 薪资范围（中文名或代码，单值） */
    private String salary;

    /** 每个关键词进入AI分析的岗位数量上限 */
    private Integer searchJobLimit;

    /** 创建时间 */
    private LocalDateTime createdAt;

    /** 更新时间 */
    private LocalDateTime updatedAt;
}
