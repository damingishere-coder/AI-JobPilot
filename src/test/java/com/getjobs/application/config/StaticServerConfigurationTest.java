package com.getjobs.application.config;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class StaticServerConfigurationTest {

    @Test
    void reusesPrimaryConnectorWhenApplicationRunsOnUnifiedPort() {
        assertThat(StaticServerConfiguration.servesFrontendOnPrimaryPort(6866)).isTrue();
        assertThat(StaticServerConfiguration.servesFrontendOnPrimaryPort(8888)).isFalse();
    }
}
