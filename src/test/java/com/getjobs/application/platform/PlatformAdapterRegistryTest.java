package com.getjobs.application.platform;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class PlatformAdapterRegistryTest {
    @Test
    void exposesFourPlatformsInStableProductOrder() {
        PlatformAdapterRegistry registry = new PlatformAdapterRegistry(List.of(
                adapter("51job", "TIER_2", "PLAYWRIGHT_LEGACY"),
                adapter("boss", "TIER_1", "CHROME_BRIDGE"),
                adapter("liepin", "TIER_2", "PLAYWRIGHT_LEGACY"),
                adapter("zhilian", "TIER_1", "CHROME_BRIDGE")
        ));

        assertThat(registry.capabilities())
                .extracting(PlatformCapability::platform)
                .containsExactly("boss", "zhilian", "liepin", "51job");
        assertThat(registry.capabilities()).allSatisfy(capability -> {
            assertThat(capability.analysisSupported()).isTrue();
            assertThat(capability.confirmationSupported()).isTrue();
        });
    }

    @Test
    void duplicateFormalAdapterFailsClosed() {
        assertThatThrownBy(() -> new PlatformAdapterRegistry(List.of(
                adapter("boss", "TIER_1", "CHROME_BRIDGE"),
                adapter("BOSS", "TIER_1", "CHROME_BRIDGE")
        ))).isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("多个正式适配器");
    }

    private PlatformAdapter adapter(String platform, String tier, String mode) {
        PlatformAdapter adapter = mock(PlatformAdapter.class);
        when(adapter.platform()).thenReturn(platform);
        when(adapter.capability()).thenReturn(new PlatformCapability(
                platform.toLowerCase(), tier, mode, true, true, mode));
        return adapter;
    }
}
