package com.getjobs.application.controller;

import com.getjobs.application.service.ProfileService;
import com.getjobs.application.service.ZhilianService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class ZhilianAnalysisProfileTest {
    @Test
    void staleProfileReturnsConflictThroughGlobalExceptionAdvice() throws Exception {
        ProfileService profiles = mock(ProfileService.class);
        when(profiles.getCurrentProfileIdOrNull()).thenReturn(7L);
        ZhilianService service = mock(ZhilianService.class);
        ZhilianController controller = new ZhilianController();
        ReflectionTestUtils.setField(controller, "profileService", profiles);
        ReflectionTestUtils.setField(controller, "zhilianService", service);
        var mvc = MockMvcBuilders.standaloneSetup(controller)
                .setControllerAdvice(new GlobalExceptionHandler()).build();
        for (String endpoint : new String[]{"list", "stats"}) {
            mvc.perform(get("/api/zhilian/" + endpoint).param("profileId", "4"))
                    .andExpect(status().isConflict())
                    .andExpect(jsonPath("$.success").value(false))
                    .andExpect(jsonPath("$.message").value("当前档案已切换，请刷新分析页"));
        }
        verifyNoInteractions(service);
    }

    @Test
    void staleProfileCannotReadListsOrStats() {
        ProfileService profiles = mock(ProfileService.class);
        when(profiles.getCurrentProfileIdOrNull()).thenReturn(7L);
        ZhilianService service = mock(ZhilianService.class);
        ZhilianController controller = new ZhilianController();
        ReflectionTestUtils.setField(controller, "profileService", profiles);
        ReflectionTestUtils.setField(controller, "zhilianService", service);
        assertThatThrownBy(() -> controller.list(null, null, null, null, null, null, null, "run-4", 1, 20, 4L))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        assertThatThrownBy(() -> controller.stats(null, null, null, null, null, null, null, "run-4", 4L))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
        verifyNoInteractions(service);
    }

    @Test
    void profileChangeDuringQueryDoesNotReturnOldResponse() {
        ProfileService profiles = mock(ProfileService.class);
        when(profiles.getCurrentProfileIdOrNull()).thenReturn(4L, 7L);
        ZhilianController controller = new ZhilianController();
        ReflectionTestUtils.setField(controller, "profileService", profiles);
        ReflectionTestUtils.setField(controller, "zhilianService", mock(ZhilianService.class));
        assertThatThrownBy(() -> controller.stats(null, null, null, null, null, null, null, "run-4", 4L))
                .isInstanceOf(ResponseStatusException.class).hasMessageContaining("409");
    }
}
