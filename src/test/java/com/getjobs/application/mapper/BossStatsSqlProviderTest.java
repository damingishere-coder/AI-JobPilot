package com.getjobs.application.mapper;

import com.getjobs.application.dto.BossStatsQuery;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class BossStatsSqlProviderTest {

    private final BossStatsSqlProvider provider = new BossStatsSqlProvider();

    @Test
    void minimumAiScoreExcludesNullAndLowerScoresInStatsQueries() {
        BossStatsQuery query = new BossStatsQuery();
        query.setProfileId(1L);
        query.setMinAiScore(60);

        assertThat(provider.selectKpi(query))
                .contains("ai_score >= #{minAiScore}");
        assertThat(provider.selectOverview(query))
                .contains("ai_score >= #{minAiScore}");
    }

    @Test
    void currentRunStatsIncludeEveryStatusWithinTheRequestedScan() {
        BossStatsQuery query = new BossStatsQuery();
        query.setProfileId(1L);
        query.setScanRunId("boss-current");

        assertThat(provider.selectKpi(query)).contains("scan_run_id = #{scanRunId}");
        assertThat(provider.selectOverview(query)).contains("scan_run_id = #{scanRunId}");
        assertThat(provider.selectStatusDistribution(query)).contains("scan_run_id = #{scanRunId}");
    }
}
