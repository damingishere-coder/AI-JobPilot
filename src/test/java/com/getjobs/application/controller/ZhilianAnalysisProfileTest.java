package com.getjobs.application.controller;

import com.getjobs.application.service.ProfileService;
import com.getjobs.application.service.ZhilianService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class ZhilianAnalysisProfileTest {
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
