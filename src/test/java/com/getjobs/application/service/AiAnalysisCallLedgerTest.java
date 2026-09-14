package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;

class AiAnalysisCallLedgerTest {
    @Test
    void samePurposeAndJobCannotSpendTwiceEvenAfterUnknown() {
        var ledger = new AiAnalysisCallLedger(List.of(1L));
        AtomicInteger calls = new AtomicInteger();
        assertThatThrownBy(() -> ledger.invoke(AiAnalysisCallLedger.Purpose.GREETING_REPAIR, 1L, () -> {
            calls.incrementAndGet();
            throw new AiProviderException(AiProviderException.Code.TIMEOUT, "synthetic", null, "test", "", true, null);
        })).isInstanceOf(AiProviderException.class);
        assertThatThrownBy(() -> ledger.invoke(AiAnalysisCallLedger.Purpose.GREETING_REPAIR, 1L, () -> {
            calls.incrementAndGet(); return "unexpected";
        })).isInstanceOf(IllegalStateException.class);
        assertThat(calls.get()).isEqualTo(1);
        assertThat(ledger.snapshot()).singleElement().satisfies(call ->
                assertThat(call).containsEntry("outcome", "UNKNOWN").containsEntry("clientRequestId", "test"));
    }

    @Test
    void boundedLogicalCallsRemainSeparateFromTransportRetriesAndSnapshotsAreImmutable() {
        var ledger = new AiAnalysisCallLedger(List.of(1L, 2L));
        ledger.invoke(AiAnalysisCallLedger.Purpose.MATCH_BATCH, null, () -> "received");
        var first = ledger.snapshot();
        ledger.invoke(AiAnalysisCallLedger.Purpose.BATCH_FORMAT_REPAIR, null, () -> "received");
        for (long id : List.of(1L, 2L)) {
            ledger.invoke(AiAnalysisCallLedger.Purpose.SINGLE_FORMAT_REPAIR, id, () -> "received");
            ledger.invoke(AiAnalysisCallLedger.Purpose.GREETING_REPAIR, id, () -> "received");
        }
        assertThat(first).hasSize(1); assertThat(ledger.snapshot()).hasSize(6);
        assertThatThrownBy(() -> ledger.invoke(AiAnalysisCallLedger.Purpose.MATCH_BATCH, null, () -> "unexpected"))
                .isInstanceOf(IllegalStateException.class);
    }
}
