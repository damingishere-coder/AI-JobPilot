package com.getjobs.worker.boss;

import lombok.Data;

import java.util.List;
import java.util.Map;

/**
 * @author loks666
 *
 * Boss配置数据类
 * 配置加载由 BossConfigLoaderService 负责
 */
@Data
public class BossConfig {
    /**
     * 用于打招呼的语句
     */
    private String sayHi;

    /**
     * 开发者模式
     */
    private Boolean debugger;

    /**
     * 搜索关键词列表
     */
    private List<String> keywords;

    /**
     * 城市编码
     */
    private List<String> cityCode;

    /**
     * 自定义城市编码映射
     */
    private Map<String, String> customCityCode;

    /**
     * 行业列表
     */
    private List<String> industry;

    /**
     * 工作经验要求
     */
    private List<String> experience;

    /**
     * 工作类型
     */
    private String jobType;

    /**
     * 每个关键词进入AI分析的岗位数量上限
     */
    private Integer searchJobLimit;

    /**
     * 薪资范围（多选）
     */
    private java.util.List<String> salary;

    /**
     * 学历要求列表
     */
    private List<String> degree;

    /**
     * 公司规模列表
     */
    private List<String> scale;

    /**
     * 公司融资阶段列表
     */
    private List<String> stage;

    /**
     * 是否开放AI检测
     */
    private Boolean enableAI;

    /**
     * 是否过滤不活跃hr
     */
    private Boolean filterDeadHR;

    /**
     * AI通过后是否自动投递
     */
    private Boolean autoDeliver;

    /**
     * 是否发送图片简历
     */
    private Boolean sendImgResume;

    /**
     * 目标薪资
     */
    private List<Integer> expectedSalary;

    /**
     * 等待时间
     */
    private String waitTime;

    /**
     * HR未上线状态
     */
    private List<String> deadStatus;
}
