package com.getjobs.application.service;

import com.getjobs.application.entity.BossConfigEntity;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.entity.JobAiAnalysisEntity;
import com.getjobs.application.entity.JobGreetingDraftEntity;
import com.getjobs.application.mapper.JobAiAnalysisMapper;
import com.getjobs.application.mapper.JobGreetingDraftMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class GreetingDraftServiceTest {
    private ProfileService profileService;
    private BossService bossService;
    private JobAiAnalysisMapper aiMapper;
    private JobGreetingDraftMapper draftMapper;
    private GreetingDraftService service;

    @BeforeEach
    void setUp() {
        profileService = mock(ProfileService.class);
        bossService = mock(BossService.class);
        aiMapper = mock(JobAiAnalysisMapper.class);
        draftMapper = mock(JobGreetingDraftMapper.class);
        service = new GreetingDraftService(
                profileService,
                bossService,
                mock(ZhilianService.class),
                mock(LiepinService.class),
                mock(Job51Service.class),
                aiMapper,
                draftMapper);
        when(profileService.getCurrentProfileId()).thenReturn(3L);
        when(bossService.getBossJobById(9L)).thenReturn(bossJob());
        BossConfigEntity config = new BossConfigEntity();
        config.setSayHi("档案默认话术");
        when(bossService.getFirstConfig()).thenReturn(config);
    }

    @Test
    void userDraftWinsAndIsNotOverwrittenWhenAiGreetingChanges() {
        JobGreetingDraftEntity draft = draft("人工定稿", LocalDateTime.of(2026, 8, 27, 10, 0));
        when(draftMapper.selectOne(any())).thenReturn(draft);
        when(aiMapper.selectOne(any()))
                .thenReturn(ai("AI 原稿一"))
                .thenReturn(ai("AI 重新分析后的原稿"));

        GreetingDraftService.GreetingView first = service.resolveForJob("boss", 9L);
        GreetingDraftService.GreetingView second = service.resolveForJob("boss", 9L);

        assertThat(first.greetingSource()).isEqualTo(GreetingDraftService.USER_EDITED);
        assertThat(first.finalGreeting()).isEqualTo("人工定稿");
        assertThat(second.aiGreeting()).isEqualTo("AI 重新分析后的原稿");
        assertThat(second.finalGreeting()).isEqualTo("人工定稿");
    }

    @Test
    void fallsBackFromAiGreetingToProfileDefaultThenEmpty() {
        when(draftMapper.selectOne(any())).thenReturn(null);
        when(aiMapper.selectOne(any())).thenReturn(ai("AI 原稿"), null, null);

        GreetingDraftService.GreetingView ai = service.resolveForJob("boss", 9L);
        GreetingDraftService.GreetingView profileDefault = service.resolveForJob("boss", 9L);
        when(bossService.getFirstConfig()).thenReturn(null);
        GreetingDraftService.GreetingView empty = service.resolveForJob("boss", 9L);

        assertThat(ai.greetingSource()).isEqualTo(GreetingDraftService.AI_GREETING);
        assertThat(profileDefault.greetingSource()).isEqualTo(GreetingDraftService.PROFILE_DEFAULT);
        assertThat(empty.greetingSource()).isEqualTo(GreetingDraftService.EMPTY);
        assertThat(empty.finalGreeting()).isEmpty();
    }

    @Test
    void staleExpectedTimestampCannotOverwriteNewerDraft() {
        LocalDateTime updatedAt = LocalDateTime.of(2026, 8, 27, 11, 30);
        when(draftMapper.selectOne(any())).thenReturn(draft("新版人工稿", updatedAt));

        assertThatThrownBy(() -> service.save("boss", 9L, "旧页面内容", "2026-08-27T11:00"))
                .isInstanceOf(GreetingDraftService.StaleDraftException.class)
                .hasMessageContaining("其他页面更新");
        verify(draftMapper, never()).update(any(), any());
    }

    private BossJobDataEntity bossJob() {
        BossJobDataEntity job = new BossJobDataEntity();
        job.setId(9L);
        job.setProfileId(3L);
        job.setEncryptId("boss-key-9");
        return job;
    }

    private JobGreetingDraftEntity draft(String content, LocalDateTime updatedAt) {
        JobGreetingDraftEntity draft = new JobGreetingDraftEntity();
        draft.setId(1L);
        draft.setProfileId(3L);
        draft.setPlatform("boss");
        draft.setJobKey("boss-key-9");
        draft.setContent(content);
        draft.setVersion(2);
        draft.setUpdatedAt(updatedAt);
        return draft;
    }

    private JobAiAnalysisEntity ai(String greeting) {
        JobAiAnalysisEntity ai = new JobAiAnalysisEntity();
        ai.setGreeting(greeting);
        return ai;
    }
}
