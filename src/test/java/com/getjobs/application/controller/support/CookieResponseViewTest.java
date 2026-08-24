package com.getjobs.application.controller.support;

import com.getjobs.application.entity.CookieEntity;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class CookieResponseViewTest {
    @Test
    void configuredCookieResponseNeverContainsRawCookie() {
        CookieEntity cookie = new CookieEntity();
        cookie.setId(42L);
        cookie.setPlatform("boss");
        cookie.setCookieValue("session=real-secret-cookie");
        cookie.setRemark("manual save");

        var data = CookieResponseView.from(cookie, "boss", "未找到Cookie记录");

        assertThat(data)
                .containsEntry("id", 42L)
                .containsEntry("platform", "boss")
                .containsEntry("configured", true)
                .doesNotContainKey("cookie_value");
        assertThat(data.toString()).doesNotContain("real-secret-cookie");
    }

    @Test
    void missingCookieReturnsExplicitRecoverableState() {
        var data = CookieResponseView.from(null, "liepin", "未找到猎聘Cookie记录");

        assertThat(data)
                .containsEntry("platform", "liepin")
                .containsEntry("configured", false)
                .containsEntry("message", "未找到猎聘Cookie记录");
    }
}
