package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class PageWindowTest {
    @Test
    void outOfRangeAndExtremePagesReturnAnEmptyWindow() {
        for (int page : new int[] {3, Integer.MAX_VALUE}) {
            int from = PageWindow.start(page, Integer.MAX_VALUE, 37);
            assertThat(from).isEqualTo(37);
            assertThat(PageWindow.end(from, Integer.MAX_VALUE, 37)).isEqualTo(37);
        }
        assertThat(PageWindow.start(Integer.MAX_VALUE, 20, 0)).isZero();
    }

    @Test
    void lastPageAndLargePageSizeStayInsideTheList() {
        assertThat(PageWindow.start(2, 20, 37)).isEqualTo(20);
        assertThat(PageWindow.end(20, 20, 37)).isEqualTo(37);
        assertThat(PageWindow.end(0, Integer.MAX_VALUE, 37)).isEqualTo(37);
        assertThat(PageWindow.start(Integer.MIN_VALUE, 20, 37)).isZero();
    }
}
