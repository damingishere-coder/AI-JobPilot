package com.getjobs.application.controller;

import com.getjobs.application.entity.BossConfigEntity;
import com.getjobs.application.service.BossService;
import com.getjobs.application.service.ProfileService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BossConfigControllerContractTest {
    private BossService bossService;
    private ProfileService profileService;
    private BossConfigController controller;

    @BeforeEach
    void setUp() {
        bossService = mock(BossService.class);
        profileService = mock(ProfileService.class);
        controller = new BossConfigController(bossService, profileService);
        when(bossService.getOptionsByType(anyString())).thenReturn(List.of());
        when(bossService.normalizeSearchJobLimit(any())).thenAnswer(invocation -> invocation.getArgument(0));
    }

    @Test
    void getUsesExplicitSuccessContractEvenWithoutProfile() {
        when(bossService.getFirstConfig()).thenReturn(null);
        when(profileService.getCurrentProfile()).thenReturn(null);
        when(profileService.hasProfiles()).thenReturn(false);

        Map<String, Object> response = controller.getAllBossConfig();

        assertThat(response).containsEntry("success", true)
                .containsEntry("message", "Boss配置加载成功")
                .containsKeys("config", "options", "blacklist", "currentProfile", "hasProfile");
        assertThat(response.get("hasProfile")).isEqualTo(false);
    }

    @Test
    void putUsesStandardEnvelope() {
        BossConfigEntity saved = new BossConfigEntity();
        saved.setSearchJobLimit(42);
        when(bossService.saveOrUpdateFirstSelective(any())).thenReturn(saved);

        Map<String, Object> response = controller.updateConfig(new BossConfigEntity());

        assertThat(response).containsEntry("success", true)
                .containsEntry("data", saved)
                .containsEntry("message", "Boss配置保存成功");
    }
}
