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

    @com.fasterxml.jackson.annotation.JsonIgnore
    private String filtersJson;

    public com.getjobs.application.dto.ZhilianFilters getFilters() {
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().readValue(
                    filtersJson == null || filtersJson.isBlank() ? "{}" : filtersJson,
                    com.getjobs.application.dto.ZhilianFilters.class);
        } catch (Exception e) { throw new IllegalStateException("智联筛选配置无法读取，请修复配置后扫描", e); }
    }

    public void setFilters(com.getjobs.application.dto.ZhilianFilters filters) {
        try { filtersJson = new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(
                filters == null ? new com.getjobs.application.dto.ZhilianFilters() : filters); }
        catch (Exception e) { throw new IllegalArgumentException("智联筛选配置无效", e); }
    }

    /** 创建时间 */
    private LocalDateTime createdAt;

    /** 更新时间 */
    private LocalDateTime updatedAt;
}
