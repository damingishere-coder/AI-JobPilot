package com.getjobs.application.mapper;

import com.getjobs.application.dto.BossStatsQuery;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.SelectProvider;

import java.util.List;

@Mapper
public interface BossStatsMapper {
    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectKpi")
    BossStatsQuery.KpiRow selectKpi(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectOverview")
    BossStatsQuery.OverviewRow selectOverview(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectStatusDistribution")
    List<BossStatsQuery.NameValueRow> selectStatusDistribution(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectFailureTypeDistribution")
    List<BossStatsQuery.NameValueRow> selectFailureTypeDistribution(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectCityDistribution")
    List<BossStatsQuery.NameValueRow> selectCityDistribution(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectIndustryDistribution")
    List<BossStatsQuery.NameValueRow> selectIndustryDistribution(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectCompanyTop")
    List<BossStatsQuery.NameValueRow> selectCompanyTop(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectExperienceDistribution")
    List<BossStatsQuery.NameValueRow> selectExperienceDistribution(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectDegreeDistribution")
    List<BossStatsQuery.NameValueRow> selectDegreeDistribution(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectDailyTrend")
    List<BossStatsQuery.NameValueRow> selectDailyTrend(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectHrActivity")
    List<BossStatsQuery.NameValueRow> selectHrActivity(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectTopCity")
    String selectTopCity(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectTopIndustry")
    String selectTopIndustry(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectTopCompany")
    String selectTopCompany(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectTopExperience")
    String selectTopExperience(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectTopDegree")
    String selectTopDegree(BossStatsQuery query);

    @SelectProvider(type = BossStatsSqlProvider.class, method = "selectSalaryRows")
    List<BossStatsQuery.SalaryRow> selectSalaryRows(BossStatsQuery query);
}
