package com.getjobs.application.service;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class SalaryParser {
    private static final BigDecimal WORK_DAYS_PER_MONTH = BigDecimal.valueOf(21.75);

    private SalaryParser() {
    }

    public static ParsedSalary parse(String salary) {
        if (salary == null) return null;
        String value = salary.trim();
        if (value.isEmpty() || value.contains("面议")) return null;

        Integer months = parseMonths(value);
        String main = value.replace(" ", "");
        Matcher monthsMatcher = Pattern.compile("[·\\.\\-]?([0-9]+)薪").matcher(main);
        if (monthsMatcher.find()) {
            main = main.substring(0, monthsMatcher.start());
        }

        ParsedSalary kSalary = parseMonthlyK(main, months);
        if (kSalary != null) return kSalary;
        return parseDailySalary(main, months);
    }

    private static ParsedSalary parseMonthlyK(String value, Integer months) {
        Matcher range = Pattern.compile("^(\\d+(?:\\.\\d+)?)K-(\\d+(?:\\.\\d+)?)K$", Pattern.CASE_INSENSITIVE).matcher(value);
        if (range.matches()) {
            double minK = Double.parseDouble(range.group(1));
            double maxK = Double.parseDouble(range.group(2));
            return parsed(minK, maxK, months);
        }

        range = Pattern.compile("^(\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?)[Kk]$").matcher(value);
        if (range.matches()) {
            double minK = Double.parseDouble(range.group(1));
            double maxK = Double.parseDouble(range.group(2));
            return parsed(minK, maxK, months);
        }

        Matcher single = Pattern.compile("^(\\d+(?:\\.\\d+)?)[Kk]$").matcher(value);
        if (single.matches()) {
            double k = Double.parseDouble(single.group(1));
            return parsed(k, k, months);
        }
        return null;
    }

    private static ParsedSalary parseDailySalary(String value, Integer months) {
        Matcher range = Pattern.compile("^(\\d+(?:\\.\\d+)?)-(\\d+(?:\\.\\d+)?)元/天$").matcher(value);
        if (range.matches()) {
            double minK = dailyYuanToMonthlyK(range.group(1));
            double maxK = dailyYuanToMonthlyK(range.group(2));
            return parsed(minK, maxK, months);
        }

        Matcher single = Pattern.compile("^(\\d+(?:\\.\\d+)?)元/天$").matcher(value);
        if (single.matches()) {
            double k = dailyYuanToMonthlyK(single.group(1));
            return parsed(k, k, months);
        }
        return null;
    }

    private static Integer parseMonths(String value) {
        Matcher matcher = Pattern.compile("[·\\.\\-]?([0-9]+)薪").matcher(value);
        if (!matcher.find()) return 12;
        try {
            return Integer.parseInt(matcher.group(1));
        } catch (Exception ignored) {
            return 12;
        }
    }

    private static double dailyYuanToMonthlyK(String dailyYuan) {
        BigDecimal yuan = new BigDecimal(dailyYuan);
        return yuan.multiply(WORK_DAYS_PER_MONTH)
                .divide(BigDecimal.valueOf(1000), 2, RoundingMode.HALF_UP)
                .doubleValue();
    }

    private static ParsedSalary parsed(double minK, double maxK, Integer months) {
        double normalizedMin = round2(Math.min(minK, maxK));
        double normalizedMax = round2(Math.max(minK, maxK));
        double median = round2((normalizedMin + normalizedMax) / 2.0);
        return new ParsedSalary(normalizedMin, normalizedMax, median, months == null ? 12 : months);
    }

    private static double round2(double value) {
        return BigDecimal.valueOf(value).setScale(2, RoundingMode.HALF_UP).doubleValue();
    }

    public record ParsedSalary(Double minK, Double maxK, Double medianK, Integer months) {
    }
}
