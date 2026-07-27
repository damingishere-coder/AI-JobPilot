package com.getjobs.application.service;

import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.mapper.AiMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AiServiceConfigTest {
    private static final Long PROFILE_ID = 1L;

    @Mock
    private AiMapper aiMapper;
    @Mock
    private ProfileService profileService;

    private AiService service;

    @BeforeEach
    void setUp() {
        service = new AiService(null, aiMapper, profileService);
        when(profileService.getCurrentProfileId()).thenReturn(PROFILE_ID);
    }

    @Test
    void legacyConfigWithoutThresholdsUsesDefaults() {
        AiEntity legacy = new AiEntity();
        legacy.setId(1L);
        legacy.setProfileId(PROFILE_ID);
        when(aiMapper.selectOne(any())).thenReturn(legacy);

        AiEntity result = service.getAiConfig();

        assertThat(result.getApplyThreshold()).isEqualTo(JobAiAnalysisService.DEFAULT_APPLY_THRESHOLD);
        assertThat(result.getPriorityApplyThreshold())
                .isEqualTo(JobAiAnalysisService.DEFAULT_PRIORITY_APPLY_THRESHOLD);
    }

    @Test
    void savesCustomThresholdsForCurrentProfile() {
        AiEntity existing = new AiEntity();
        existing.setId(1L);
        existing.setProfileId(PROFILE_ID);
        when(aiMapper.selectOne(any())).thenReturn(existing);

        service.saveOrUpdateAiConfig("技能介绍", "提示词", 60, 50);

        ArgumentCaptor<AiEntity> captor = ArgumentCaptor.forClass(AiEntity.class);
        verify(aiMapper).updateById(captor.capture());
        assertThat(captor.getValue().getApplyThreshold()).isEqualTo(60);
        assertThat(captor.getValue().getPriorityApplyThreshold()).isEqualTo(50);
    }

    @Test
    void thresholdOnlyUpdateKeepsExistingIntroductionAndPrompt() {
        AiEntity existing = new AiEntity();
        existing.setId(1L);
        existing.setProfileId(PROFILE_ID);
        existing.setIntroduce("原有技能介绍");
        existing.setPrompt("原有提示词");
        existing.setApplyThreshold(75);
        existing.setPriorityApplyThreshold(65);
        when(aiMapper.selectOne(any())).thenReturn(existing);

        service.saveOrUpdateAiThresholds(60, 50);

        ArgumentCaptor<AiEntity> captor = ArgumentCaptor.forClass(AiEntity.class);
        verify(aiMapper).updateById(captor.capture());
        assertThat(captor.getValue().getIntroduce()).isEqualTo("原有技能介绍");
        assertThat(captor.getValue().getPrompt()).isEqualTo("原有提示词");
        assertThat(captor.getValue().getApplyThreshold()).isEqualTo(60);
        assertThat(captor.getValue().getPriorityApplyThreshold()).isEqualTo(50);
    }

    @Test
    void rejectsPriorityThresholdHigherThanRegularThreshold() {
        when(aiMapper.selectOne(any())).thenReturn(null);

        assertThatThrownBy(() -> service.saveOrUpdateAiConfig("技能介绍", "提示词", 60, 70))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("不能高于");
    }
}
