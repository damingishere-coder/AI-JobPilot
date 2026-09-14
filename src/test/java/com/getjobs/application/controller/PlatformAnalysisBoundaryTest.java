package com.getjobs.application.controller;

import com.getjobs.application.platform.PlatformAdapterRegistry;
import com.getjobs.application.platform.job51.Job51PlatformAdapter;
import com.getjobs.application.platform.liepin.LiepinPlatformAdapter;
import com.getjobs.application.service.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class PlatformAnalysisBoundaryTest {
    @Test
    void unsupportedLegacyAnalysisIsRejectedBeforeJobReadOrEnqueue() {
        var liepin = mock(LiepinService.class);
        var job51 = mock(Job51Service.class);
        var profiles = mock(ProfileService.class);
        var queue = mock(ChromeJobAnalysisQueueService.class);
        var registry = new PlatformAdapterRegistry(List.of(new LiepinPlatformAdapter(liepin), new Job51PlatformAdapter(job51)));
        var controller = new PlatformAnalysisController(registry, profiles, queue);
        for (String platform : List.of("liepin", "51job")) {
            assertThat(registry.required(platform).capability().analysisSupported()).isFalse();
            assertThat(controller.analyze(platform, 1L).getStatusCode().value()).isEqualTo(409);
        }
        verifyNoInteractions(liepin, job51, profiles, queue);
    }
}
