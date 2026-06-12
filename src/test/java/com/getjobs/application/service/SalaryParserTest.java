package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SalaryParserTest {
    @Test
    void parsesMonthlyKRange() {
        SalaryParser.ParsedSalary salary = SalaryParser.parse("20-35K");

        assertThat(salary.minK()).isEqualTo(20.0);
        assertThat(salary.maxK()).isEqualTo(35.0);
        assertThat(salary.medianK()).isEqualTo(27.5);
        assertThat(salary.months()).isEqualTo(12);
    }

    @Test
    void parsesMonthlyKRangeWithBonusMonths() {
        SalaryParser.ParsedSalary salary = SalaryParser.parse("20-35K·13薪");

        assertThat(salary.minK()).isEqualTo(20.0);
        assertThat(salary.maxK()).isEqualTo(35.0);
        assertThat(salary.medianK()).isEqualTo(27.5);
        assertThat(salary.months()).isEqualTo(13);
    }

    @Test
    void parsesKOnBothSides() {
        SalaryParser.ParsedSalary salary = SalaryParser.parse("15K-25K");

        assertThat(salary.minK()).isEqualTo(15.0);
        assertThat(salary.maxK()).isEqualTo(25.0);
        assertThat(salary.medianK()).isEqualTo(20.0);
    }

    @Test
    void returnsNullForNegotiableSalary() {
        assertThat(SalaryParser.parse("面议")).isNull();
    }

    @Test
    void parsesDailySalaryAsMonthlyK() {
        SalaryParser.ParsedSalary salary = SalaryParser.parse("200-300元/天");

        assertThat(salary.minK()).isEqualTo(4.35);
        assertThat(salary.maxK()).isEqualTo(6.53);
        assertThat(salary.medianK()).isEqualTo(5.44);
        assertThat(salary.months()).isEqualTo(12);
    }
}
