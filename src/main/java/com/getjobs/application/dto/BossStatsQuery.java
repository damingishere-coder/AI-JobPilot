package com.getjobs.application.dto;

import lombok.Data;

import java.util.List;

@Data
public class BossStatsQuery {
    private Long profileId;
    private List<String> statuses = List.of();
    private String location;
    private String experience;
    private String degree;
    private Double minK;
    private Double maxK;
    private Integer minAiScore;
    private String keyword;
    private String scanRunId;
    private Boolean filterHeadhunter = false;
    private boolean idFilterApplied;
    private List<Long> filteredIds = List.of();

    public boolean hasSalaryFilter() {
        return minK != null || maxK != null;
    }

    @Data
    public static class KpiRow {
        private Long total;
        private Long delivered;
        private Long pending;
        private Long waitingConfirm;
        private Long listCollected;
        private Long filtered;
        private Long failed;
        private Long insufficient;
    }

    @Data
    public static class NameValueRow {
        private String name;
        private Long value;
    }

    @Data
    public static class OverviewRow {
        private Double aiAvgScore;
        private Long aiPassCount;
        private Long aiRejectCount;
        private Long aiFailedCount;
        private Long priorityCompanyCount;
        private Long missingLinkCount;
        private Long missingSalaryCount;
        private String latestCreatedAt;
    }

    @Data
    public static class SalaryRow {
        private Long id;
        private String salary;
        private Double salaryMinK;
        private Double salaryMaxK;
        private Double salaryMedianK;
        private Integer salaryMonths;
    }
}
