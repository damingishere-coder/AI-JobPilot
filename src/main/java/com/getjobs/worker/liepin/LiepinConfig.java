package com.getjobs.worker.liepin;

import lombok.Data;

import java.util.List;

/**
 * @author loks666
 */
@Data
public class LiepinConfig {
    /**
     * 搜索关键词列表
     */
    private List<String> keywords;

    /**
     * 城市编码
     */
    private String cityCode;

    /**
     * 薪资范围
     */
    private String salary;

}
