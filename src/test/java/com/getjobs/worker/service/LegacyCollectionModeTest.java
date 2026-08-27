package com.getjobs.worker.service;

import com.getjobs.application.service.ConfigService;
import com.getjobs.worker.job51.Job51;
import com.getjobs.worker.job51.Job51Config;
import com.getjobs.worker.liepin.Liepin;
import com.getjobs.worker.liepin.LiepinConfig;
import com.getjobs.worker.manager.PlaywrightManager;
import com.microsoft.playwright.Page;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class LegacyCollectionModeTest {
    @Test
    void liepinCollectionMarksWorkerScanOnlyBeforeExecution() {
        PlaywrightManager manager = mock(PlaywrightManager.class);
        ConfigService configService = mock(ConfigService.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<Liepin> provider = mock(ObjectProvider.class);
        Liepin worker = mock(Liepin.class);
        when(manager.getLiepinPage()).thenReturn(mock(Page.class));
        when(manager.isLoggedIn("liepin")).thenReturn(true);
        when(configService.getLiepinConfig()).thenReturn(new LiepinConfig());
        when(provider.getObject()).thenReturn(worker);
        when(worker.execute()).thenReturn(0);

        new LiepinJobService(manager, configService, provider).executeCollection(message -> {});

        verify(worker).setScanOnly(true);
        verify(worker).execute();
    }

    @Test
    void job51CollectionMarksWorkerScanOnlyBeforeExecution() {
        PlaywrightManager manager = mock(PlaywrightManager.class);
        ConfigService configService = mock(ConfigService.class);
        @SuppressWarnings("unchecked")
        ObjectProvider<Job51> provider = mock(ObjectProvider.class);
        Job51 worker = mock(Job51.class);
        when(manager.getJob51Page()).thenReturn(mock(Page.class));
        when(manager.isLoggedIn("51job")).thenReturn(true);
        when(configService.getJob51Config()).thenReturn(new Job51Config());
        when(provider.getObject()).thenReturn(worker);
        when(worker.execute()).thenReturn(0);

        new Job51JobService(manager, provider, configService).executeCollection(message -> {});

        verify(worker).setScanOnly(true);
        verify(worker).prepare();
        verify(worker).execute();
    }
}
