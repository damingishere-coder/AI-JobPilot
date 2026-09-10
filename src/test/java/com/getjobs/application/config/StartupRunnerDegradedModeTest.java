package com.getjobs.application.config;

import com.getjobs.worker.manager.PlaywrightManager;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;

class StartupRunnerDegradedModeTest {

    @Test
    void keepsBackendRunningWhenPlaywrightInitializationFails() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        doThrow(new IllegalStateException("浏览器启动失败")).when(playwrightManager).init();

        StartupRunner runner = new StartupRunner();
        ReflectionTestUtils.setField(runner, "playwrightManager", playwrightManager);
        ReflectionTestUtils.setField(runner, "autoOpenBrowser", false);
        ReflectionTestUtils.setField(runner, "initializeBrowserOnStartup", true);
        ReflectionTestUtils.setField(runner, "backendPort", 6866);

        assertThatCode(() -> runner.run(null)).doesNotThrowAnyException();
    }

    @Test
    void skipsPlaywrightInitializationByDefault() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);

        StartupRunner runner = new StartupRunner();
        ReflectionTestUtils.setField(runner, "playwrightManager", playwrightManager);
        ReflectionTestUtils.setField(runner, "autoOpenBrowser", false);
        ReflectionTestUtils.setField(runner, "initializeBrowserOnStartup", false);
        ReflectionTestUtils.setField(runner, "backendPort", 6866);

        assertThatCode(() -> runner.run(null)).doesNotThrowAnyException();
        verifyNoInteractions(playwrightManager);
    }
}
