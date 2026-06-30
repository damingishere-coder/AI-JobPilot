package com.getjobs.application.platform;

public enum PlatformType {
    BOSS("boss"),
    ZHILIAN("zhilian"),
    LIEPIN("liepin"),
    JOB51("51job");

    private final String code;

    PlatformType(String code) {
        this.code = code;
    }

    public String code() {
        return code;
    }
}
