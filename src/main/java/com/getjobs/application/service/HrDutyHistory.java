package com.getjobs.application.service;

import java.time.*;
import java.util.regex.Pattern;

/** Parses only explicit dates or the platform's known relative labels. Unknown dates never become today. */
public final class HrDutyHistory {
    private HrDutyHistory() { }
    public static LocalDate date(String value, LocalDate today) {
        String text = value == null ? "" : value.strip();
        var full = Pattern.compile("^(\\d{4})[-/年](\\d{1,2})[-/月](\\d{1,2})(?:日)?(?:[ T].*)?$").matcher(text);
        try {
            if (full.matches()) return LocalDate.of(Integer.parseInt(full.group(1)),Integer.parseInt(full.group(2)),Integer.parseInt(full.group(3)));
            if (text.matches("(?:今天\\s*)?\\d{1,2}:\\d{2}" ) || text.equals("今天")) return today;
            if (text.matches("昨天(?:\\s+\\d{1,2}:\\d{2})?")) return today.minusDays(1);
            if (text.matches("前天(?:\\s+\\d{1,2}:\\d{2})?")) return today.minusDays(2);
            var shortDate = Pattern.compile("^(\\d{1,2})[-/月](\\d{1,2})(?:日)?(?: .*)?$").matcher(text);
            if (shortDate.matches()) {
                LocalDate d=LocalDate.of(today.getYear(),Integer.parseInt(shortDate.group(1)),Integer.parseInt(shortDate.group(2)));
                return d.isAfter(today)?d.minusYears(1):d;
            }
        } catch (DateTimeException | NumberFormatException ignored) { }
        return null;
    }
}
