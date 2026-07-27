package com.getjobs.application.config;

import com.getjobs.worker.manager.PlaywrightManager;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;

class StartupRunnerDegradedModeTest {

    @Test
    void keepsBackendRunningWhenPlaywrightInitializationFails() {
        PlaywrightManager playwrightManager = mock(PlaywrightManager.class);
        doThrow(new IllegalStateException("浏览器启动失败")).when(playwrightManager).init();

        StartupRunner runner = new StartupRunner();
        ReflectionTestUtils.setField(runner, "playwrightManager", playwrightManager);
        ReflectionTestUtils.setField(runner, "autoOpenBrowser", false);
        ReflectionTestUtils.setField(runner, "backendPort", 8888);

        assertThatCode(() -> runner.run(null)).doesNotThrowAnyException();
    }
}
