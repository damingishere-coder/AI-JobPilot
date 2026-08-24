package com.getjobs.application.entity;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableField;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 猎聘岗位快照数据实体
 * 保存从猎聘接口获取的有价值字段
 */
@Data
@TableName("liepin_data")
public class LiepinEntity {
    @TableId(type = IdType.AUTO)
    private Long id;

    @TableField("profile_id")
    private Long profileId;

    // ========== 岗位字段 ==========
    private Long jobId;           // job.jobId
    private String jobTitle;      // job.title
    private String jobLink;       // job.link
    private String jobSalaryText; // job.salary
    private String jobArea;       // job.dq
    private String jobEduReq;     // job.requireEduLevel
    private String jobExpReq;     // job.requireWorkYears
    private String jobPublishTime;// job.refreshTime

    // ========== 公司字段 ==========
    private Long compId;          // comp.compId
    private String compName;      // comp.compName
    private String compIndustry;  // comp.compIndustry
    private String compScale;     // comp.compScale

    // ========== HR字段 ==========
    private String hrId;          // recruiter.recruiterId
    private String hrName;        // recruiter.recruiterName
    private String hrTitle;       // recruiter.recruiterTitle
    private String hrImId;        // recruiter.imId

    // ========== 投递状态 ==========
    // 是否已投递：0 未投递（默认），1 已投递
    private Integer delivered;
    // 新投递状态真相的兼容读模型；只有 CONFIRMED 才会同时写 delivered=1
    private String deliveryStatus;

    // ========== 系统字段 ==========
    private LocalDateTime createTime;
    private LocalDateTime updateTime;
}
