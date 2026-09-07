package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

class ZhilianStatsOverviewTest {
    @Test
    void overviewUsesAllMatchingRowsIncludingZeroScoresAndPreservesScope() {
        ProfileService profiles = mock(ProfileService.class);
        when(profiles.getCurrentProfileIdOrNull()).thenReturn(4L);
        ZhilianJobDataMapper mapper = mock(ZhilianJobDataMapper.class);
        ZhilianService service = new ZhilianService(null, null, mapper, null, profiles);
        List<ZhilianJobDataEntity> jobs = new ArrayList<>();
        LocalDateTime latest = LocalDateTime.of(2026, 9, 7, 10, 0);
        for (int i = 0; i < 25; i++) {
            ZhilianJobDataEntity job = new ZhilianJobDataEntity();
            job.setAiScore(i == 24 ? 0 : 100);
            job.setPriorityCompany(1);
            job.setSalary("10-20K");
            job.setCreateTime(latest.minusDays(i));
            jobs.add(job);
        }
        when(mapper.selectList(any(Wrapper.class))).thenAnswer(call -> {
            Wrapper<?> wrapper = call.getArgument(0);
            assertThat(wrapper.getSqlSegment()).contains("profile_id", "scan_run_id");
            return jobs;
        });
        var stats = service.getZhilianStats(null, null, null, null, null, null, null, "run-4");
        assertThat(stats.kpi.total).isEqualTo(25);
        assertThat(stats.overview.aiAvgScore).isEqualTo(96.0);
        assertThat(stats.overview.priorityCompanyCount).isEqualTo(25);
        assertThat(stats.overview.missingLinkCount).isEqualTo(25);
        assertThat(stats.overview.missingSalaryCount).isZero();
        assertThat(stats.overview.latestCreatedAt).isEqualTo(latest);
        var excluded = service.getZhilianStats(null, null, null, null, 30.0, null, null, "run-4");
        assertThat(excluded.kpi.total).isZero();
        assertThat(excluded.overview.aiAvgScore).isNull();
        assertThat(excluded.overview.missingLinkCount).isZero();
    }
}
