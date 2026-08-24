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

    @Test
    void locksRequestedUnknownAndTerminalDeliveryStates() {
        assertThat(DeliveryStatus.isDeliveryLocked(DeliveryStatus.DELIVERY_REQUESTED)).isTrue();
        assertThat(DeliveryStatus.isDeliveryLocked(DeliveryStatus.DELIVERY_UNKNOWN)).isTrue();
        assertThat(DeliveryStatus.isDeliveryLocked(DeliveryStatus.DELIVERED)).isTrue();
        assertThat(DeliveryStatus.isDeliveryLocked(DeliveryStatus.DELIVERY_FAILED)).isTrue();
        assertThat(DeliveryStatus.protectDelivered(
                DeliveryStatus.DELIVERY_UNKNOWN,
                DeliveryStatus.AI_ANALYZING
        )).isEqualTo(DeliveryStatus.DELIVERY_UNKNOWN);
    }
}
