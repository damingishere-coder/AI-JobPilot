package com.getjobs.application.service;

import com.getjobs.application.entity.ResumeProfileEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
import com.getjobs.application.mapper.Job51Mapper;
import com.getjobs.application.mapper.JobAiAnalysisMapper;
import com.getjobs.application.mapper.LiepinMapper;
import com.getjobs.application.mapper.PriorityCompanyMapper;
import com.getjobs.application.mapper.ResumeProfileMapper;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class JobAiKeywordPersistenceTest {
    private final ProfileService profileService = mock(ProfileService.class);
    private final ResumeProfileMapper resumeProfileMapper = mock(ResumeProfileMapper.class);
    private JobAiAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new JobAiAnalysisService(
                mock(AiService.class), profileService, resumeProfileMapper,
                mock(PriorityCompanyMapper.class), mock(JobAiAnalysisMapper.class),
                mock(BossJobDataMapper.class), mock(ZhilianJobDataMapper.class),
                mock(LiepinMapper.class), mock(Job51Mapper.class)
        );
        when(profileService.getCurrentProfileId()).thenReturn(7L);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(7L);
    }

    @Test
    void changedResumeInvalidatesOldRecommendations() {
        ResumeProfileEntity current = resume("旧简历", "[\"旧岗位\"]");
        when(resumeProfileMapper.selectOne(any())).thenReturn(current);

        service.saveResumeText("新简历", "resume.txt", "manual", "已确认");

        assertThat(current.getRecommendedJobKeywords()).isNull();
        verify(resumeProfileMapper).updateById(current);
    }

    @Test
    void sameResumeKeepsRecommendations() {
        ResumeProfileEntity current = resume("同一份简历", "[\"AI产品经理\"]");
        when(resumeProfileMapper.selectOne(any())).thenReturn(current);

        service.saveResumeText("同一份简历", "resume.txt", "manual", "已确认");

        assertThat(current.getRecommendedJobKeywords()).isEqualTo("[\"AI产品经理\"]");
    }

    @Test
    void recommendationsAreStoredAsCanonicalJsonForCurrentProfile() {
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume("简历", null));

        List<String> saved = service.saveRecommendedJobKeywords(List.of("Java", "AI产品经理", "java"));

        ArgumentCaptor<ResumeProfileEntity> captor = ArgumentCaptor.forClass(ResumeProfileEntity.class);
        verify(resumeProfileMapper).updateById(captor.capture());
        assertThat(saved).containsExactly("Java", "AI产品经理");
        assertThat(captor.getValue().getId()).isEqualTo(11L);
        assertThat(captor.getValue().getRecommendedJobKeywords()).isEqualTo("[\"Java\",\"AI产品经理\"]");
    }

    private ResumeProfileEntity resume(String text, String keywords) {
        ResumeProfileEntity entity = new ResumeProfileEntity();
        entity.setId(11L);
        entity.setProfileId(7L);
        entity.setResumeText(text);
        entity.setRecommendedJobKeywords(keywords);
        return entity;
    }
}
