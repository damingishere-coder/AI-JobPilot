package com.getjobs.application.strategy;

import java.util.regex.Pattern;

/** Deliberately narrow normalization. Ambiguous salary/role text stays unknown. */
public final class StrategyDimensions {
    private StrategyDimensions() {}
    public static String role(String title) {
        if(title==null) return "未知";
        if(title.contains("运营")) return "运营";
        if(title.contains("产品")) return "产品";
        if(title.matches(".*(开发|工程师|程序员).*")) return "开发与工程";
        if(title.contains("设计")) return "设计";
        return "其他或未分类";
    }
    public static String salary(String text) {
        if(text==null) return "未知";
        var matcher=Pattern.compile("^\\s*(\\d+(?:\\.\\d+)?)\\s*[-~至]\\s*(\\d+(?:\\.\\d+)?)\\s*[kK](?:[··/].*)?\\s*$").matcher(text);
        if(!matcher.matches()) return "未知";
        double low=Double.parseDouble(matcher.group(1)),high=Double.parseDouble(matcher.group(2));
        if(low>high||low<1||high>200) return "未知";
        double middle=(low+high)/2;
        return middle<10?"中点低于10K":middle<20?"中点10–20K":middle<30?"中点20–30K":"中点30K及以上";
    }
    public static String score(Integer score) {
        return score==null?"未知":score>=80?"历史分80及以上":score>=60?"历史分60–79":"历史分低于60";
    }
}
