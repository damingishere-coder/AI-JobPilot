package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
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
class BossServiceAiScoreFilterTest {
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
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(1L);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void listQueryIncludesMinimumAiScore() {
        when(bossJobDataMapper.selectList(any())).thenReturn(List.of());

        bossService.listBossJobs(
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                1,
                20,
                false,
                null,
                60
        );

        ArgumentCaptor<QueryWrapper> captor = ArgumentCaptor.forClass(QueryWrapper.class);
        verify(bossJobDataMapper).selectList(captor.capture());
        QueryWrapper<BossJobDataEntity> wrapper = captor.getValue();
        assertThat(wrapper.getSqlSegment()).contains("ai_score");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(60);
    }

    @Test
    @SuppressWarnings({"rawtypes", "unchecked"})
    void jobLookupIsScopedToCurrentProfile() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(null);

        bossService.getBossJobById(99L);

        ArgumentCaptor<QueryWrapper> captor = ArgumentCaptor.forClass(QueryWrapper.class);
        verify(bossJobDataMapper).selectOne(captor.capture());
        QueryWrapper<BossJobDataEntity> wrapper = captor.getValue();
        assertThat(wrapper.getSqlSegment()).contains("id").contains("profile_id");
        assertThat(wrapper.getParamNameValuePairs().values()).contains(99L, 1L);
    }
}
