package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import java.time.LocalDate;
import static org.assertj.core.api.Assertions.assertThat;

class HrDutyHistoryTest {
    @Test void explicitAndRelativeDatesRespectTheCalendarBoundary() {
        var today=LocalDate.of(2026,1,2);
        assertThat(HrDutyHistory.date("12月31日 10:30",today)).isEqualTo(LocalDate.of(2025,12,31));
        assertThat(HrDutyHistory.date("昨天 10:30",today)).isEqualTo(LocalDate.of(2026,1,1));
        assertThat(HrDutyHistory.date("2025-12-03",today)).isEqualTo(LocalDate.of(2025,12,3));
        assertThat(HrDutyHistory.date("2026-02-30",today)).isNull();
        assertThat(HrDutyHistory.date("",today)).isNull();
        assertThat(HrDutyHistory.date("很久以前",today)).isNull();
    }
}
