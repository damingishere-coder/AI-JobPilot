package com.getjobs.application.service;

import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class BossServiceSalaryStructureTest {
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
    void insertBossJobWritesStructuredSalaryFields() {
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        BossJobDataEntity job = new BossJobDataEntity();
        job.setCompanyName("测试公司");
        job.setJobName("Java工程师");
        job.setSalary("20-35K·13薪");

        bossService.insertBossJob(job);

        ArgumentCaptor<BossJobDataEntity> captor = ArgumentCaptor.forClass(BossJobDataEntity.class);
        verify(bossJobDataMapper).insert(captor.capture());
        BossJobDataEntity inserted = captor.getValue();
        assertThat(inserted.getSalaryMinK()).isEqualTo(20.0);
        assertThat(inserted.getSalaryMaxK()).isEqualTo(35.0);
        assertThat(inserted.getSalaryMedianK()).isEqualTo(27.5);
        assertThat(inserted.getSalaryMonths()).isEqualTo(13);
    }
}
