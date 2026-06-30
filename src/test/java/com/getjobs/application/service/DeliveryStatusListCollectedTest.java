package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class DeliveryStatusListCollectedTest {

    @Test
    void acceptsListCollectedWithoutTreatingItAsFinalStatus() {
        assertThat(DeliveryStatus.normalizeChromeStatus("LIST_COLLECTED"))
                .isEqualTo(DeliveryStatus.LIST_COLLECTED);
        assertThat(DeliveryStatus.isFinalStatus(DeliveryStatus.LIST_COLLECTED))
                .isFalse();
    }
}
