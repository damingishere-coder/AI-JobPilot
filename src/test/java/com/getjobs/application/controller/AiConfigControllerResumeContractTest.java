package com.getjobs.application.controller;

import com.getjobs.application.dto.ResumeParseResult;
import com.getjobs.application.dto.ResumeSaveRequest;
import com.getjobs.application.entity.ResumeProfileEntity;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.ResumeDocumentParsingService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class AiConfigControllerResumeContractTest {
    private JobAiAnalysisService jobAiAnalysisService;
    private ResumeDocumentParsingService parsingService;
    private AiConfigController controller;

    @BeforeEach
    void setUp() {
        jobAiAnalysisService = mock(JobAiAnalysisService.class);
        parsingService = mock(ResumeDocumentParsingService.class);
        controller = new AiConfigController();
        ReflectionTestUtils.setField(controller, "jobAiAnalysisService", jobAiAnalysisService);
        ReflectionTestUtils.setField(controller, "resumeDocumentParsingService", parsingService);
    }

    @Test
    void parseReturnsPreviewWithoutWritingDatabase() {
        MockMultipartFile file = new MockMultipartFile("file", "resume.pdf", "application/pdf", new byte[]{1});
        ResumeParseResult preview = new ResumeParseResult(
                "简历文本", "本地文本", "resume.pdf", "local-docling", 91, List.of());
        when(parsingService.parse(file, "local")).thenReturn(preview);

        ResponseEntity<Map<String, Object>> response = controller.parseResume(file, "local");

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).containsEntry("success", true).containsEntry("data", preview);
        verify(jobAiAnalysisService, never()).saveResumeText(anyString(), any(), anyString(), anyString());
    }

    @Test
    void emptyConfirmedTextCannotOverwriteExistingResume() {
        ResumeSaveRequest request = new ResumeSaveRequest();
        request.setResumeText("  ");
        when(parsingService.normalizeResumeText(any())).thenReturn("");

        ResponseEntity<Map<String, Object>> response = controller.saveResume(request);

        assertThat(response.getStatusCode().is4xxClientError()).isTrue();
        assertThat(response.getBody()).containsEntry("success", false);
        verify(jobAiAnalysisService, never()).saveResumeText(anyString(), any(), anyString(), anyString());
    }

    @Test
    void confirmedPreviewIsSavedWithExistingParseFields() {
        ResumeSaveRequest request = new ResumeSaveRequest();
        request.setResumeText("经用户编辑的简历");
        request.setSourceFilename("resume.docx");
        request.setParseMethod("ai-reviewed");
        request.setQualityScore(92);
        request.setWarnings(List.of("用户已核对"));
        when(parsingService.normalizeResumeText(request.getResumeText())).thenReturn(request.getResumeText());
        ResumeProfileEntity saved = new ResumeProfileEntity();
        saved.setResumeText(request.getResumeText());
        when(jobAiAnalysisService.saveResumeText(anyString(), anyString(), anyString(), anyString())).thenReturn(saved);

        ResponseEntity<Map<String, Object>> response = controller.saveResume(request);

        assertThat(response.getStatusCode().is2xxSuccessful()).isTrue();
        assertThat(response.getBody()).containsEntry("success", true).containsEntry("data", saved);
        verify(jobAiAnalysisService).saveResumeText(
                request.getResumeText(), "resume.docx", "ai_reviewed", "用户已确认识别预览；质量分 92；用户已核对");
    }
}
