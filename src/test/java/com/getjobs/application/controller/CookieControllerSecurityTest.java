package com.getjobs.application.controller;

import com.getjobs.application.service.CookieService;
import com.getjobs.worker.manager.PlaywrightManager;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

class CookieControllerSecurityTest {
    @Test
    void platformAliasesAreAlsoRetiredWithoutDependencies() {
        var liepin = mock(LiepinController.class, CALLS_REAL_METHODS);
        var zhilian = mock(ZhilianController.class, CALLS_REAL_METHODS);
        var job = mock(JobController.class, CALLS_REAL_METHODS);
        for (var response : java.util.List.of(liepin.getLiepinCookieRecord(), liepin.saveLiepinCookie(),
                zhilian.getZhilianCookieRecord(), zhilian.saveZhilianCookie(), job.get51jobCookieRecord(), job.save51jobCookie())) {
            assertThat(response.getStatusCode().value()).isEqualTo(410);
        }
    }
    @Test
    void retiredEndpointsNeverReadDatabaseOrInitializeBrowser() {
        CookieService service = mock(CookieService.class);
        PlaywrightManager manager = mock(PlaywrightManager.class);
        CookieController controller = new CookieController(service, manager);
        for (String platform : new String[]{"boss", "zhilian", "liepin", "51job"}) {
            for (var response : java.util.List.of(controller.getCookie(platform), controller.saveCookie(platform, "manual"))) {
                assertThat(response.getStatusCode().value()).isEqualTo(410);
                assertThat(response.getBody()).containsEntry("errorCode", "BROWSER_SESSION_ONLY");
            }
        }
        assertThat(controller.getCookie("unknown").getStatusCode().value()).isEqualTo(400);
        verifyNoInteractions(service, manager);
    }
}
