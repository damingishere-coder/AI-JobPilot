package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class LocalActionTokenServiceTest {

    @Test
    void issuesNonReusableAcrossInstancesAndValidatesExactly() {
        LocalActionTokenService first = new LocalActionTokenService();
        LocalActionTokenService second = new LocalActionTokenService();

        assertThat(first.issueToken()).isNotBlank().hasSizeGreaterThan(32);
        assertThat(first.issueToken()).isNotEqualTo(second.issueToken());
        assertThat(first.isValid(first.issueToken())).isTrue();
        assertThat(first.isValid(second.issueToken())).isFalse();
        assertThat(first.isValid(null)).isFalse();
    }
}
