package com.getjobs.application.controller;

import com.getjobs.application.entity.CookieEntity;
import com.getjobs.application.service.CookieService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class CookieControllerSecurityTest {
    @Mock
    private CookieService cookieService;

    @Test
    void cookieEndpointReturnsConfiguredStateWithoutRawCookie() {
        CookieEntity cookie = new CookieEntity();
        cookie.setId(7L);
        cookie.setPlatform("boss");
        cookie.setCookieValue("session=real-secret-cookie");
        when(cookieService.getCookieByPlatform("boss")).thenReturn(cookie);

        var response = new CookieController(cookieService, null).getCookie("boss");

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).isNotNull();
        assertThat(response.getBody().toString())
                .contains("configured=true")
                .doesNotContain("cookie_value")
                .doesNotContain("real-secret-cookie");
    }
}
