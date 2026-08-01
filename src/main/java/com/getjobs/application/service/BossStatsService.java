package com.getjobs.application.service;

import com.getjobs.application.dto.BossStatsQuery;
import com.getjobs.application.mapper.BossStatsMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class BossStatsService {
    private final BossStatsMapper bossStatsMapper;
    private final ProfileService profileService;
    private final BossService bossService;

    public BossService.StatsResponse getBossStats(
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            String keyword,
            boolean filterHeadhunter,
            String scanRunId
    ) {
        return getBossStats(
                statuses,
                location,
                experience,
                degree,
                minK,
                maxK,
                null,
                keyword,
                filterHeadhunter,
                scanRunId
        );
    }

    public BossService.StatsResponse getBossStats(
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            Integer minAiScore,
            String keyword,
            boolean filterHeadhunter,
            String scanRunId
    ) {
        BossService.StatsResponse response = emptyResponse();
        try {
            Long profileId = profileService.getCurrentProfileIdOrNull();
            if (profileId == null) {
                return response;
            }

            BossStatsQuery baseQuery = buildQuery(
                    profileId,
                    statuses,
                    location,
                    experience,
                    degree,
                    minK,
                    maxK,
                    minAiScore,
                    keyword,
                    filterHeadhunter,
                    bossService.normalizeExplicitBossScanRunId(scanRunId)
            );
            PreparedQuery prepared = prepareSalaryFilter(baseQuery);
            BossStatsQuery query = prepared.query();

            response.kpi = toKpi(bossStatsMapper.selectKpi(query));
            response.overview = toOverview(query, bossStatsMapper.selectOverview(query));
            response.charts = toCharts(query);

            SalaryStats salaryStats = salaryStats(prepared.salaryRows() == null
                    ? bossStatsMapper.selectSalaryRows(query)
                    : prepared.salaryRows());
            response.kpi.avgMonthlyK = salaryStats.avgMonthlyK();
            response.charts.salaryBuckets = salaryStats.buckets();
            return response;
        } catch (Exception e) {
            log.error("获取Boss SQL统计失败: {}", e.getMessage(), e);
            return response;
        }
    }

    private BossStatsQuery buildQuery(
            Long profileId,
            List<String> statuses,
            String location,
            String experience,
            String degree,
            Double minK,
            Double maxK,
            Integer minAiScore,
            String keyword,
            boolean filterHeadhunter,
            String scanRunId
    ) {
        BossStatsQuery query = new BossStatsQuery();
        query.setProfileId(profileId);
        query.setStatuses(statuses == null ? List.of() : statuses.stream()
                .filter(s -> s != null && !s.isBlank())
                .map(String::trim)
                .collect(Collectors.toList()));
        query.setLocation(trimToNull(location));
        query.setExperience(trimToNull(experience));
        query.setDegree(trimToNull(degree));
        query.setMinK(minK);
        query.setMaxK(maxK);
        query.setMinAiScore(normalizeAiScore(minAiScore));
        query.setKeyword(trimToNull(keyword));
        query.setFilterHeadhunter(filterHeadhunter);
        query.setScanRunId(trimToNull(scanRunId));
        return query;
    }

    private PreparedQuery prepareSalaryFilter(BossStatsQuery query) {
        if (!query.hasSalaryFilter()) {
            return new PreparedQuery(query, null);
        }

        List<BossStatsQuery.SalaryRow> candidates = safeSalaryRows(bossStatsMapper.selectSalaryRows(query));
        List<Long> matchedIds = new ArrayList<>();
        List<BossStatsQuery.SalaryRow> matchedRows = new ArrayList<>();
        for (BossStatsQuery.SalaryRow row : candidates) {
            if (row == null || row.getId() == null) continue;
            Double medianK = salaryMedianK(row);
            if (medianK == null) continue;
            boolean ok = true;
            if (query.getMinK() != null) ok = medianK >= query.getMinK();
            if (query.getMaxK() != null) ok = ok && medianK <= query.getMaxK();
            if (ok) {
                matchedIds.add(row.getId());
                matchedRows.add(row);
            }
        }

        BossStatsQuery scoped = copyQuery(query);
        scoped.setIdFilterApplied(true);
        scoped.setFilteredIds(List.copyOf(matchedIds));
        return new PreparedQuery(scoped, List.copyOf(matchedRows));
    }

    private BossStatsQuery copyQuery(BossStatsQuery source) {
        BossStatsQuery copy = new BossStatsQuery();
        copy.setProfileId(source.getProfileId());
        copy.setStatuses(source.getStatuses() == null ? List.of() : List.copyOf(source.getStatuses()));
        copy.setLocation(source.getLocation());
        copy.setExperience(source.getExperience());
        copy.setDegree(source.getDegree());
        copy.setMinK(source.getMinK());
        copy.setMaxK(source.getMaxK());
        copy.setMinAiScore(source.getMinAiScore());
        copy.setKeyword(source.getKeyword());
        copy.setScanRunId(source.getScanRunId());
        copy.setFilterHeadhunter(source.getFilterHeadhunter());
        copy.setIdFilterApplied(source.isIdFilterApplied());
        copy.setFilteredIds(source.getFilteredIds() == null ? List.of() : List.copyOf(source.getFilteredIds()));
        return copy;
    }

    private BossService.Kpi toKpi(BossStatsQuery.KpiRow row) {
        BossService.Kpi kpi = new BossService.Kpi();
        if (row == null) return kpi;
        kpi.total = nvl(row.getTotal());
        kpi.delivered = nvl(row.getDelivered());
        kpi.pending = nvl(row.getPending());
        kpi.waitingConfirm = nvl(row.getWaitingConfirm());
        kpi.listCollected = nvl(row.getListCollected());
        kpi.filtered = nvl(row.getFiltered());
        kpi.failed = nvl(row.getFailed());
        kpi.insufficient = nvl(row.getInsufficient());
        return kpi;
    }

    private BossService.Overview toOverview(BossStatsQuery query, BossStatsQuery.OverviewRow row) {
        BossService.Overview overview = new BossService.Overview();
        if (row != null) {
            overview.aiAvgScore = row.getAiAvgScore();
            overview.aiPassCount = nvl(row.getAiPassCount());
            overview.aiRejectCount = nvl(row.getAiRejectCount());
            overview.aiFailedCount = nvl(row.getAiFailedCount());
            overview.priorityCompanyCount = nvl(row.getPriorityCompanyCount());
            overview.missingLinkCount = nvl(row.getMissingLinkCount());
            overview.missingSalaryCount = nvl(row.getMissingSalaryCount());
            overview.latestCreatedAt = row.getLatestCreatedAt();
        }
        overview.topCity = bossStatsMapper.selectTopCity(query);
        overview.topIndustry = bossStatsMapper.selectTopIndustry(query);
        overview.topCompany = bossStatsMapper.selectTopCompany(query);
        overview.topExperience = bossStatsMapper.selectTopExperience(query);
        overview.topDegree = bossStatsMapper.selectTopDegree(query);
        return overview;
    }

    private BossService.Charts toCharts(BossStatsQuery query) {
        BossService.Charts charts = emptyCharts();
        charts.byStatus = toNameValues(bossStatsMapper.selectStatusDistribution(query));
        charts.byFailureType = toNameValues(bossStatsMapper.selectFailureTypeDistribution(query));
        charts.byCity = toNameValues(bossStatsMapper.selectCityDistribution(query));
        charts.byIndustry = toNameValues(bossStatsMapper.selectIndustryDistribution(query));
        charts.byCompany = toNameValues(bossStatsMapper.selectCompanyTop(query));
        charts.byExperience = toNameValues(bossStatsMapper.selectExperienceDistribution(query));
        charts.byDegree = toNameValues(bossStatsMapper.selectDegreeDistribution(query));
        charts.dailyTrend = toNameValues(bossStatsMapper.selectDailyTrend(query));
        charts.hrActivity = toNameValues(bossStatsMapper.selectHrActivity(query));
        return charts;
    }

    private List<BossService.NameValue> toNameValues(List<BossStatsQuery.NameValueRow> rows) {
        List<BossService.NameValue> result = new ArrayList<>();
        if (rows == null) return result;
        for (BossStatsQuery.NameValueRow row : rows) {
            if (row == null) continue;
            result.add(new BossService.NameValue(row.getName() == null || row.getName().isBlank() ? "未知" : row.getName(), nvl(row.getValue())));
        }
        return result;
    }

    private SalaryStats salaryStats(List<BossStatsQuery.SalaryRow> rows) {
        List<Double> medians = new ArrayList<>();
        double sumMedian = 0.0;
        double maxMedian = 0.0;
        for (BossStatsQuery.SalaryRow row : safeSalaryRows(rows)) {
            Double medianK = salaryMedianK(row);
            if (medianK == null) continue;
            medians.add(medianK);
            sumMedian += medianK;
            if (medianK > maxMedian) maxMedian = medianK;
        }

        Double avg = medians.isEmpty() ? null : Math.round((sumMedian / medians.size()) * 100.0) / 100.0;
        int topEdge = (int) Math.ceil(maxMedian / 5.0) * 5;
        if (topEdge <= 20) topEdge = 25;

        long b0_10 = 0;
        long b10_15 = 0;
        long b15_20 = 0;
        long b20Top = 0;
        long bGeTop = 0;
        for (double median : medians) {
            if (median < 10) b0_10++;
            else if (median < 15) b10_15++;
            else if (median < 20) b15_20++;
            else if (median < topEdge) b20Top++;
            else bGeTop++;
        }

        List<BossService.BucketValue> buckets = new ArrayList<>();
        buckets.add(new BossService.BucketValue("0-10K", b0_10));
        buckets.add(new BossService.BucketValue("10-15K", b10_15));
        buckets.add(new BossService.BucketValue("15-20K", b15_20));
        buckets.add(new BossService.BucketValue("20-" + topEdge + "K", b20Top));
        buckets.add(new BossService.BucketValue(">=" + topEdge + "K", bGeTop));
        return new SalaryStats(avg, buckets);
    }

    private BossService.StatsResponse emptyResponse() {
        BossService.StatsResponse response = new BossService.StatsResponse();
        response.kpi = new BossService.Kpi();
        response.charts = emptyCharts();
        response.overview = new BossService.Overview();
        return response;
    }

    private BossService.Charts emptyCharts() {
        BossService.Charts charts = new BossService.Charts();
        charts.byStatus = new ArrayList<>();
        charts.byCity = new ArrayList<>();
        charts.byIndustry = new ArrayList<>();
        charts.byCompany = new ArrayList<>();
        charts.byExperience = new ArrayList<>();
        charts.byDegree = new ArrayList<>();
        charts.salaryBuckets = new ArrayList<>();
        charts.dailyTrend = new ArrayList<>();
        charts.hrActivity = new ArrayList<>();
        charts.byFailureType = new ArrayList<>();
        return charts;
    }

    private List<BossStatsQuery.SalaryRow> safeSalaryRows(List<BossStatsQuery.SalaryRow> rows) {
        return rows == null ? List.of() : rows;
    }

    private Double salaryMedianK(BossStatsQuery.SalaryRow row) {
        if (row == null) return null;
        if (row.getSalaryMedianK() != null) return row.getSalaryMedianK();
        if (row.getSalaryMinK() != null && row.getSalaryMaxK() != null) {
            return Math.round(((row.getSalaryMinK() + row.getSalaryMaxK()) / 2.0) * 100.0) / 100.0;
        }
        BossService.SalaryInfo info = BossService.parseSalary(row.getSalary());
        return info == null ? null : info.medianK;
    }

    private long nvl(Long value) {
        return value == null ? 0L : value;
    }

    private String trimToNull(String value) {
        return value == null || value.isBlank() ? null : value.trim();
    }

    private Integer normalizeAiScore(Integer value) {
        if (value == null) return null;
        return Math.max(0, Math.min(100, value));
    }

    private record PreparedQuery(BossStatsQuery query, List<BossStatsQuery.SalaryRow> salaryRows) {
    }

    private record SalaryStats(Double avgMonthlyK, List<BossService.BucketValue> buckets) {
    }
}
