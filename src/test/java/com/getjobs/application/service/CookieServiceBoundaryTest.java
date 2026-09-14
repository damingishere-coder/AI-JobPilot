package com.getjobs.application.service;

import com.getjobs.application.mapper.CookieMapper;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;

class CookieServiceBoundaryTest {
    @Test
    void retainedCompatibilityServiceCannotReadChangeOrDeleteHistoricalCookies() {
        CookieMapper mapper = mock(CookieMapper.class);
        CookieService service = new CookieService(mapper);
        for (Runnable operation : java.util.List.<Runnable>of(
                () -> service.getCookieByPlatform("boss"), service::getAllCookies,
                () -> service.saveOrUpdateCookie("boss", "synthetic", "test"),
                () -> service.clearCookieByPlatform("boss", "test"), () -> service.deleteCookie("boss"))) {
            assertThatThrownBy(operation::run).isInstanceOf(UnsupportedOperationException.class);
        }
        verifyNoInteractions(mapper);
    }
}
