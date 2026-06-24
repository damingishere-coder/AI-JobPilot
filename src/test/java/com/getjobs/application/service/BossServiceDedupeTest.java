package com.getjobs.application.service;

import com.getjobs.application.dto.ChromeJobDto;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BossServiceDedupeTest {
    @Mock
    private BossJobDataMapper bossJobDataMapper;
    @Mock
    private ProfileService profileService;

    private BossService bossService;

    @BeforeEach
    void setUp() {
        bossService = new BossService(
                null,
                null,
                null,
                null,
                bossJobDataMapper,
                null,
                profileService
        );
    }

    @Test
    void batchDedupeMatchesByEncryptIdFirstAndCompanyTitleFallback() {
        List<ChromeJobDto> jobs = List.of(
                chromeJob("job-1", null, "新公司", "新岗位"),
                chromeJob(null, null, "重点公司", "后端工程师"),
                chromeJob(null, null, "重点公司", "前端工程师")
        );
        BossJobDataEntity idMatched = bossJob(11L, "job-1", "旧公司", "旧岗位");
        BossJobDataEntity companyTitleMatched = bossJob(12L, null, "重点公司", "后端工程师");
        when(bossJobDataMapper.selectExistingChromeBossJobs(
                eq(1L),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList()
        )).thenReturn(List.of(idMatched, companyTitleMatched));

        Map<Integer, BossJobDataEntity> result = bossService.findExistingChromeBossJobs(1L, jobs, " run-1 ");

        assertThat(result).containsEntry(0, idMatched);
        assertThat(result).containsEntry(1, companyTitleMatched);
        assertThat(result).doesNotContainKey(2);
        verify(bossJobDataMapper).selectExistingChromeBossJobs(
                eq(1L),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList()
        );
    }

    @Test
    void batchDedupeExtractsBossIdFromUrlAndPassesLookupFieldsToMapper() {
        List<ChromeJobDto> jobs = List.of(
                chromeJob(null, "https://www.zhipin.com/web/geek/job_detail/url-job-1?lid=abc", "A公司", "Java"),
                chromeJob("job-2", null, "B公司", "测试")
        );
        when(bossJobDataMapper.selectExistingChromeBossJobs(
                eq(2L),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList()
        )).thenReturn(List.of());

        bossService.findExistingChromeBossJobs(2L, jobs, null);

        ArgumentCaptor<List<String>> encryptIdsCaptor = ArgumentCaptor.forClass(List.class);
        ArgumentCaptor<List<String>> companyNamesCaptor = ArgumentCaptor.forClass(List.class);
        ArgumentCaptor<List<String>> jobNamesCaptor = ArgumentCaptor.forClass(List.class);
        verify(bossJobDataMapper).selectExistingChromeBossJobs(
                eq(2L),
                encryptIdsCaptor.capture(),
                companyNamesCaptor.capture(),
                jobNamesCaptor.capture()
        );
        assertThat(encryptIdsCaptor.getValue()).containsExactly("url-job-1", "job-2");
        assertThat(companyNamesCaptor.getValue()).containsExactly("A公司", "B公司");
        assertThat(jobNamesCaptor.getValue()).containsExactly("Java", "测试");
    }

    @Test
    void batchDedupeSkipsDatabaseWhenNoLookupKeyExists() {
        List<ChromeJobDto> jobs = List.of(chromeJob(null, null, "", ""));

        Map<Integer, BossJobDataEntity> result = bossService.findExistingChromeBossJobs(1L, jobs, null);

        assertThat(result).isEmpty();
        verify(bossJobDataMapper, never()).selectExistingChromeBossJobs(
                org.mockito.ArgumentMatchers.any(),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList(),
                org.mockito.ArgumentMatchers.anyList()
        );
    }

    @Test
    void upsertUpdatesHistoricalJobAcrossScanRunsInsteadOfCreatingDuplicateRow() {
        BossJobDataEntity existing = bossJob(21L, "job-history", "历史公司", "Java工程师");
        existing.setDeliveryStatus(DeliveryStatus.LIST_COLLECTED);
        existing.setScanRunId("run-old");
        existing.setJobDescription("");

        BossJobDataEntity incoming = bossJob(null, "job-history", "历史公司", "Java工程师");
        incoming.setDeliveryStatus(DeliveryStatus.NOT_DELIVERED);
        incoming.setJobDescription("这是重新进入详情页后采集到的完整岗位要求，长度足够用于后续AI分析。");

        when(profileService.getCurrentProfileId()).thenReturn(1L);
        when(bossJobDataMapper.selectOne(any(QueryWrapper.class))).thenReturn(existing);
        when(bossJobDataMapper.selectById(21L)).thenAnswer(invocation -> existing);

        bossService.upsertChromeBossJob(incoming, "run-new");

        ArgumentCaptor<BossJobDataEntity> updateCaptor = ArgumentCaptor.forClass(BossJobDataEntity.class);
        verify(bossJobDataMapper).updateById(updateCaptor.capture());
        BossJobDataEntity updated = updateCaptor.getValue();
        assertThat(updated.getId()).isEqualTo(21L);
        assertThat(updated.getScanRunId()).isEqualTo("run-new");
        assertThat(updated.getJobDescription()).contains("完整岗位要求");
        verify(bossJobDataMapper, never()).insert(any(BossJobDataEntity.class));
    }

    private ChromeJobDto chromeJob(String id, String url, String company, String title) {
        ChromeJobDto dto = new ChromeJobDto();
        dto.setId(id);
        dto.setUrl(url);
        dto.setCompany(company);
        dto.setTitle(title);
        return dto;
    }

    private BossJobDataEntity bossJob(Long id, String encryptId, String companyName, String jobName) {
        BossJobDataEntity entity = new BossJobDataEntity();
        entity.setId(id);
        entity.setProfileId(1L);
        entity.setEncryptId(encryptId);
        entity.setCompanyName(companyName);
        entity.setJobName(jobName);
        return entity;
    }
}
