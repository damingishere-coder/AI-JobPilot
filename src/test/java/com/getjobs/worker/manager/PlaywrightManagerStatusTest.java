package com.getjobs.worker.manager;

import com.microsoft.playwright.BrowserContext;
import com.microsoft.playwright.Page;
import com.microsoft.playwright.Playwright;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlaywrightManagerStatusTest {

    @Test
    void persistentContextIsInitializedWithoutStandaloneBrowserHandle() {
        PlaywrightManager manager = new PlaywrightManager();
        Page bossPage = availablePage();
        Page liepinPage = availablePage();
        Page job51Page = availablePage();
        Page zhilianPage = availablePage();

        ReflectionTestUtils.setField(manager, "playwright", mock(Playwright.class));
        ReflectionTestUtils.setField(manager, "context", mock(BrowserContext.class));
        ReflectionTestUtils.setField(manager, "browser", null);
        ReflectionTestUtils.setField(manager, "bossPage", bossPage);
        ReflectionTestUtils.setField(manager, "liepinPage", liepinPage);
        ReflectionTestUtils.setField(manager, "job51Page", job51Page);
        ReflectionTestUtils.setField(manager, "zhilianPage", zhilianPage);

        ReflectionTestUtils.setField(manager, "playwrightInitializing", true);
        assertThat(manager.isInitialized()).isFalse();

        ReflectionTestUtils.setField(manager, "playwrightInitializing", false);
        assertThat(manager.isInitialized()).isTrue();
    }

    private Page availablePage() {
        Page page = mock(Page.class);
        when(page.isClosed()).thenReturn(false);
        return page;
    }
}
