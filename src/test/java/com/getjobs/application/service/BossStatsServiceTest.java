package com.getjobs.application.service;

import com.getjobs.application.dto.BossStatsQuery;
import com.getjobs.application.mapper.BossStatsMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BossStatsServiceTest {
    @Mock
    private BossStatsMapper bossStatsMapper;
    @Mock
    private ProfileService profileService;
    @Mock
    private BossService bossService;

    private BossStatsService service;

    @BeforeEach
    void setUp() {
        service = new BossStatsService(bossStatsMapper, profileService, bossService);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
    }

    @Test
    void statsUseSqlAggregatesAndKeepResponseShape() {
        stubCommonMapperResults(List.of(salaryRow(1L, "10-20K"), salaryRow(2L, "面议")));

        BossService.StatsResponse response = service.getBossStats(
                List.of(DeliveryStatus.WAITING_CONFIRM),
                "深圳",
                "3-5年",
                "本科",
                null,
                null,
                "Java",
                true,
                null
        );

        assertThat(response.kpi.total).isEqualTo(3);
        assertThat(response.kpi.waitingConfirm).isEqualTo(2);
        assertThat(response.kpi.avgMonthlyK).isEqualTo(15.0);
        assertThat(response.charts.byStatus).extracting(item -> item.name).containsExactly(DeliveryStatus.WAITING_CONFIRM);
        assertThat(response.charts.salaryBuckets).extracting(bucket -> bucket.bucket)
                .containsExactly("0-10K", "10-15K", "15-20K", "20-25K", ">=25K");
        assertThat(response.overview.topCity).isEqualTo("深圳");

        ArgumentCaptor<BossStatsQuery> queryCaptor = ArgumentCaptor.forClass(BossStatsQuery.class);
        verify(bossStatsMapper).selectKpi(queryCaptor.capture());
        BossStatsQuery query = queryCaptor.getValue();
        assertThat(query.getProfileId()).isEqualTo(1L);
        assertThat(query.getScanRunId()).isNull();
        assertThat(query.getStatuses()).containsExactly(DeliveryStatus.WAITING_CONFIRM);
        assertThat(query.getLocation()).isEqualTo("深圳");
        assertThat(query.getKeyword()).isEqualTo("Java");
        assertThat(query.getFilterHeadhunter()).isTrue();
        assertThat(query.isIdFilterApplied()).isFalse();
    }

    @Test
    void salaryFilterBuildsIdScopeBeforeSqlAggregates() {
        when(bossService.normalizeExplicitBossScanRunId("run-1")).thenReturn("run-1");
        stubCommonMapperResults(List.of(
                salaryRow(1L, "10-20K"),
                salaryRow(2L, "30-40K"),
                salaryRow(3L, "20-30K")
        ));

        BossService.StatsResponse response = service.getBossStats(
                null,
                null,
                null,
                null,
                15.0,
                25.0,
                null,
                false,
                "run-1"
        );

        assertThat(response.kpi.avgMonthlyK).isEqualTo(20.0);
        ArgumentCaptor<BossStatsQuery> queryCaptor = ArgumentCaptor.forClass(BossStatsQuery.class);
        verify(bossStatsMapper).selectKpi(queryCaptor.capture());
        BossStatsQuery query = queryCaptor.getValue();
        assertThat(query.getScanRunId()).isEqualTo("run-1");
        assertThat(query.isIdFilterApplied()).isTrue();
        assertThat(query.getFilteredIds()).containsExactly(1L, 3L);
    }

    @Test
    void salaryStatsPreferStructuredMedianK() {
        stubCommonMapperResults(List.of(salaryRow(1L, "10-20K", 40.0)));

        BossService.StatsResponse response = service.getBossStats(
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                false,
                null
        );

        assertThat(response.kpi.avgMonthlyK).isEqualTo(40.0);
    }

    @Test
    void minimumAiScoreIsAppliedToEverySqlAggregate() {
        stubCommonMapperResults(List.of(salaryRow(1L, "20-30K")));

        service.getBossStats(
                null,
                null,
                null,
                null,
                null,
                null,
                60,
                null,
                false,
                null
        );

        ArgumentCaptor<BossStatsQuery> queryCaptor = ArgumentCaptor.forClass(BossStatsQuery.class);
        verify(bossStatsMapper).selectKpi(queryCaptor.capture());
        assertThat(queryCaptor.getValue().getMinAiScore()).isEqualTo(60);
    }

    private void stubCommonMapperResults(List<BossStatsQuery.SalaryRow> salaryRows) {
        when(bossStatsMapper.selectKpi(any())).thenReturn(kpiRow());
        when(bossStatsMapper.selectOverview(any())).thenReturn(overviewRow());
        when(bossStatsMapper.selectStatusDistribution(any())).thenReturn(List.of(nameValue(DeliveryStatus.WAITING_CONFIRM, 2L)));
        when(bossStatsMapper.selectFailureTypeDistribution(any())).thenReturn(List.of(nameValue(DeliveryStatus.UNKNOWN_FAILURE_TYPE, 1L)));
        when(bossStatsMapper.selectCityDistribution(any())).thenReturn(List.of(nameValue("深圳", 2L)));
        when(bossStatsMapper.selectIndustryDistribution(any())).thenReturn(List.of(nameValue("互联网", 2L)));
        when(bossStatsMapper.selectCompanyTop(any())).thenReturn(List.of(nameValue("测试公司", 2L)));
        when(bossStatsMapper.selectExperienceDistribution(any())).thenReturn(List.of(nameValue("3-5年", 2L)));
        when(bossStatsMapper.selectDegreeDistribution(any())).thenReturn(List.of(nameValue("本科", 2L)));
        when(bossStatsMapper.selectDailyTrend(any())).thenReturn(List.of(nameValue("2026-06-12", 2L)));
        when(bossStatsMapper.selectHrActivity(any())).thenReturn(List.of(nameValue("HR", 1L)));
        when(bossStatsMapper.selectTopCity(any())).thenReturn("深圳");
        when(bossStatsMapper.selectTopIndustry(any())).thenReturn("互联网");
        when(bossStatsMapper.selectTopCompany(any())).thenReturn("测试公司");
        when(bossStatsMapper.selectTopExperience(any())).thenReturn("3-5年");
        when(bossStatsMapper.selectTopDegree(any())).thenReturn("本科");
        when(bossStatsMapper.selectSalaryRows(any())).thenReturn(salaryRows);
    }

    private BossStatsQuery.KpiRow kpiRow() {
        BossStatsQuery.KpiRow row = new BossStatsQuery.KpiRow();
        row.setTotal(3L);
        row.setDelivered(1L);
        row.setPending(0L);
        row.setWaitingConfirm(2L);
        row.setListCollected(0L);
        row.setFiltered(0L);
        row.setFailed(0L);
        row.setInsufficient(0L);
        return row;
    }

    private BossStatsQuery.OverviewRow overviewRow() {
        BossStatsQuery.OverviewRow row = new BossStatsQuery.OverviewRow();
        row.setAiAvgScore(82.5);
        row.setAiPassCount(2L);
        row.setAiRejectCount(1L);
        row.setAiFailedCount(0L);
        row.setPriorityCompanyCount(1L);
        row.setMissingLinkCount(0L);
        row.setMissingSalaryCount(1L);
        row.setLatestCreatedAt("2026-06-12T10:00:00");
        return row;
    }

    private BossStatsQuery.NameValueRow nameValue(String name, Long value) {
        BossStatsQuery.NameValueRow row = new BossStatsQuery.NameValueRow();
        row.setName(name);
        row.setValue(value);
        return row;
    }

    private BossStatsQuery.SalaryRow salaryRow(Long id, String salary) {
        BossStatsQuery.SalaryRow row = new BossStatsQuery.SalaryRow();
        row.setId(id);
        row.setSalary(salary);
        return row;
    }

    private BossStatsQuery.SalaryRow salaryRow(Long id, String salary, Double medianK) {
        BossStatsQuery.SalaryRow row = salaryRow(id, salary);
        row.setSalaryMedianK(medianK);
        return row;
    }
}
