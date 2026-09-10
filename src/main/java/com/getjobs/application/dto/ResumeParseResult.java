package com.getjobs.application.dto;

import java.util.List;

public record ResumeParseResult(
        String text,
        String localText,
        String sourceFilename,
        String method,
        int qualityScore,
        List<String> warnings
) {
    public ResumeParseResult {
        text = text == null ? "" : text;
        localText = localText == null ? "" : localText;
        sourceFilename = sourceFilename == null ? "" : sourceFilename;
        method = method == null ? "local" : method;
        qualityScore = Math.max(0, Math.min(100, qualityScore));
        warnings = warnings == null ? List.of() : List.copyOf(warnings);
    }
}
