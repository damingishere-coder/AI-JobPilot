package com.getjobs.application.mapper;

import com.getjobs.application.dto.BossStatsQuery;
import com.getjobs.application.service.DeliveryStatus;

import java.util.List;

public class BossStatsSqlProvider {
    public String selectKpi(BossStatsQuery query) {
        return """
                SELECT
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS delivered,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS pending,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS waiting_confirm,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS list_collected,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS filtered,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS failed,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' THEN 1 ELSE 0 END), 0) AS insufficient
                FROM boss_data
                %s
                """.formatted(
                DeliveryStatus.DELIVERED,
                DeliveryStatus.NOT_DELIVERED,
                DeliveryStatus.WAITING_CONFIRM,
                DeliveryStatus.LIST_COLLECTED,
                DeliveryStatus.FILTERED,
                DeliveryStatus.DELIVERY_FAILED,
                DeliveryStatus.COLLECTION_INSUFFICIENT,
                where(query)
        );
    }

    public String selectOverview(BossStatsQuery query) {
        return """
                SELECT
                    ROUND(AVG(ai_score), 1) AS ai_avg_score,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) IN ('%s', '%s') THEN 1 ELSE 0 END), 0) AS ai_pass_count,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' OR TRIM(COALESCE(ai_decision, '')) = '%s' THEN 1 ELSE 0 END), 0) AS ai_reject_count,
                    COALESCE(SUM(CASE WHEN TRIM(COALESCE(delivery_status, '')) = '%s' OR TRIM(COALESCE(ai_decision, '')) = '%s' THEN 1 ELSE 0 END), 0) AS ai_failed_count,
                    COALESCE(SUM(CASE WHEN priority_company = 1 THEN 1 ELSE 0 END), 0) AS priority_company_count,
                    COALESCE(SUM(CASE WHEN job_url IS NULL OR TRIM(job_url) = '' THEN 1 ELSE 0 END), 0) AS missing_link_count,
                    COALESCE(SUM(CASE WHEN salary IS NULL OR TRIM(salary) = '' THEN 1 ELSE 0 END), 0) AS missing_salary_count,
                    MAX(created_at) AS latest_created_at
                FROM boss_data
                %s
                """.formatted(
                DeliveryStatus.WAITING_CONFIRM,
                DeliveryStatus.DELIVERED,
                DeliveryStatus.AI_NOT_MATCH,
                DeliveryStatus.AI_NOT_MATCH,
                DeliveryStatus.AI_ANALYSIS_FAILED,
                DeliveryStatus.AI_ANALYSIS_FAILED,
                where(query)
        );
    }

    public String selectStatusDistribution(BossStatsQuery query) {
        return groupQuery(query, "delivery_status", null, null);
    }

    public String selectFailureTypeDistribution(BossStatsQuery query) {
        return groupQuery(
                query,
                "failure_type",
                "TRIM(COALESCE(delivery_status, '')) = '" + DeliveryStatus.DELIVERY_FAILED + "'",
                null
        );
    }

    public String selectCityDistribution(BossStatsQuery query) {
        return groupQuery(query, "location", null, 10);
    }

    public String selectIndustryDistribution(BossStatsQuery query) {
        return groupQuery(query, "industry", null, 10);
    }

    public String selectCompanyTop(BossStatsQuery query) {
        return groupQuery(query, "company_name", null, 10);
    }

    public String selectExperienceDistribution(BossStatsQuery query) {
        return groupQuery(query, "experience", null, null);
    }

    public String selectDegreeDistribution(BossStatsQuery query) {
        return groupQuery(query, "degree", null, null);
    }

    public String selectDailyTrend(BossStatsQuery query) {
        return """
                SELECT COALESCE(NULLIF(TRIM(substr(created_at, 1, 10)), ''), '未知') AS name,
                       COUNT(*) AS value
                FROM boss_data
                %s
                GROUP BY name
                ORDER BY name ASC
                """.formatted(where(query));
    }

    public String selectHrActivity(BossStatsQuery query) {
        return groupQuery(query, "hr_name", "hr_active_status IS NOT NULL AND TRIM(hr_active_status) <> ''", null);
    }

    public String selectTopCity(BossStatsQuery query) {
        return topValueQuery(query, "location");
    }

    public String selectTopIndustry(BossStatsQuery query) {
        return topValueQuery(query, "industry");
    }

    public String selectTopCompany(BossStatsQuery query) {
        return topValueQuery(query, "company_name");
    }

    public String selectTopExperience(BossStatsQuery query) {
        return topValueQuery(query, "experience");
    }

    public String selectTopDegree(BossStatsQuery query) {
        return topValueQuery(query, "degree");
    }

    public String selectSalaryRows(BossStatsQuery query) {
        return """
                SELECT id,
                       salary,
                       salary_min_k,
                       salary_max_k,
                       salary_median_k,
                       salary_months
                FROM boss_data
                %s
                  AND (
                      salary_median_k IS NOT NULL
                      OR (salary IS NOT NULL AND TRIM(salary) <> '')
                  )
                """.formatted(where(query));
    }

    private String groupQuery(BossStatsQuery query, String column, String extraCondition, Integer limit) {
        StringBuilder sql = new StringBuilder();
        sql.append("SELECT COALESCE(NULLIF(TRIM(").append(column).append("), ''), '未知') AS name, COUNT(*) AS value ");
        sql.append("FROM boss_data ");
        sql.append(where(query));
        if (hasText(extraCondition)) {
            sql.append(" AND ").append(extraCondition);
        }
        sql.append(" GROUP BY name ORDER BY value DESC");
        if (limit != null) {
            sql.append(" LIMIT ").append(limit);
        }
        return sql.toString();
    }

    private String topValueQuery(BossStatsQuery query, String column) {
        return "SELECT " + column + " " +
                "FROM boss_data " +
                where(query) +
                " AND " + column + " IS NOT NULL AND TRIM(" + column + ") <> '' " +
                "GROUP BY " + column + " ORDER BY COUNT(*) DESC LIMIT 1";
    }

    private String where(BossStatsQuery query) {
        StringBuilder sql = new StringBuilder("WHERE profile_id = #{profileId}");
        if (hasText(query.getScanRunId())) {
            sql.append(" AND scan_run_id = #{scanRunId}");
        }
        if (!isEmpty(query.getStatuses())) {
            sql.append(" AND delivery_status IN (").append(placeholders("statuses", query.getStatuses().size())).append(")");
        }
        if (hasText(query.getLocation())) {
            sql.append(" AND location = #{location}");
        }
        if (hasText(query.getExperience())) {
            sql.append(" AND experience = #{experience}");
        }
        if (hasText(query.getDegree())) {
            sql.append(" AND degree = #{degree}");
        }
        if (query.getMinAiScore() != null) {
            sql.append(" AND ai_score >= #{minAiScore}");
        }
        if (hasText(query.getKeyword())) {
            sql.append(" AND (company_name LIKE '%' || #{keyword} || '%'")
                    .append(" OR job_name LIKE '%' || #{keyword} || '%'")
                    .append(" OR hr_name LIKE '%' || #{keyword} || '%'")
                    .append(" OR source_keyword LIKE '%' || #{keyword} || '%')");
        }
        if (Boolean.TRUE.equals(query.getFilterHeadhunter())) {
            sql.append(" AND (hr_position IS NULL OR hr_position NOT LIKE '%猎头%')");
        }
        if (query.isIdFilterApplied()) {
            if (isEmpty(query.getFilteredIds())) {
                sql.append(" AND 1 = 0");
            } else {
                sql.append(" AND id IN (").append(placeholders("filteredIds", query.getFilteredIds().size())).append(")");
            }
        }
        return sql.toString();
    }

    private String placeholders(String property, int size) {
        StringBuilder sql = new StringBuilder();
        for (int i = 0; i < size; i++) {
            if (i > 0) sql.append(", ");
            sql.append("#{").append(property).append("[").append(i).append("]}");
        }
        return sql.toString();
    }

    private boolean isEmpty(List<?> values) {
        return values == null || values.isEmpty();
    }

    private boolean hasText(String value) {
        return value != null && !value.isBlank();
    }
}
