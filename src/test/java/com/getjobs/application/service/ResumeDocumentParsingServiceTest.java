package com.getjobs.application.service;

import com.getjobs.application.dto.ResumeParseResult;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ResumeDocumentParsingServiceTest {
    private LocalResumeParserService localParser;
    private AiService aiService;
    private ResumeDocumentParsingService service;

    @BeforeEach
    void setUp() {
        localParser = mock(LocalResumeParserService.class);
        aiService = mock(AiService.class);
        service = new ResumeDocumentParsingService(localParser, aiService);
        ReflectionTestUtils.setField(service, "maxPages", 10);
        ReflectionTestUtils.setField(service, "maxOutputChars", 200_000);
    }

    @Test
    void normalizesKangxiRadicalsWithoutChangingChinesePunctuation() {
        String text = "工作经历：负责\u2FA6融、\u2F08力、\u2F24数据、\u2F12。\n邮箱：a@example.com\n"
                + "项目经历 ".repeat(30);
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.txt", "text/plain", text.getBytes(StandardCharsets.UTF_8));

        ResumeParseResult result = service.parse(file, "local");

        assertThat(result.text()).contains("金融、人力、大数据、力。")
                .doesNotContain("\u2FA6", "\u2F08", "\u2F24", "\u2F12");
        verify(aiService, never()).reviewResumeImages(anyList(), anyString());
    }

    @Test
    void highQualityImageDoesNotCallAi() {
        when(localParser.parse(org.mockito.ArgumentMatchers.any(), anyString()))
                .thenReturn(new LocalResumeParserService.LocalParseOutput(highQualityResume(), "docling-rapidocr", 1, List.of()));
        MockMultipartFile file = jpegFile();

        ResumeParseResult result = service.parse(file, "auto");

        assertThat(result.method()).startsWith("local-");
        assertThat(result.qualityScore()).isGreaterThanOrEqualTo(85);
        verify(aiService, never()).reviewResumeImages(anyList(), anyString());
    }

    @Test
    void lowQualityImageCallsAiExactlyOnce() {
        when(localParser.parse(org.mockito.ArgumentMatchers.any(), anyString()))
                .thenReturn(new LocalResumeParserService.LocalParseOutput("张三", "docling-rapidocr", 1, List.of()));
        when(aiService.reviewResumeImages(anyList(), anyString())).thenReturn(highQualityResume());

        ResumeParseResult result = service.parse(jpegFile(), "auto");

        assertThat(result.method()).isEqualTo("ai-reviewed");
        verify(aiService).reviewResumeImages(anyList(), anyString());
    }

    @Test
    void aiFailureReturnsUsableLocalPreviewWithoutRetry() {
        when(localParser.parse(org.mockito.ArgumentMatchers.any(), anyString()))
                .thenReturn(new LocalResumeParserService.LocalParseOutput("工作经历\n张三\n手机 13800138000", "docling-rapidocr", 1, List.of()));
        when(aiService.reviewResumeImages(anyList(), anyString())).thenThrow(new IllegalStateException("timeout"));

        ResumeParseResult result = service.parse(jpegFile(), "auto");

        assertThat(result.text()).contains("张三");
        assertThat(result.warnings()).anyMatch(item -> item.contains("未自动重试"));
        verify(aiService).reviewResumeImages(anyList(), anyString());
    }

    @Test
    void rejectsDamagedPdfBeforeLocalParser() {
        MockMultipartFile file = new MockMultipartFile(
                "file", "resume.pdf", "application/pdf", "not-pdf".getBytes(StandardCharsets.UTF_8));

        assertThatThrownBy(() -> service.parse(file, "local"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("扩展名不匹配");
        verify(localParser, never()).parse(org.mockito.ArgumentMatchers.any(), anyString());
    }

    private MockMultipartFile jpegFile() {
        return new MockMultipartFile(
                "file", "resume.jpg", "image/jpeg", new byte[]{(byte) 0xff, (byte) 0xd8, (byte) 0xff, 0});
    }

    private String highQualityResume() {
        return "张三\n手机：13800138000\n邮箱：zhangsan@example.com\n工作经历\n"
                + "负责 Java、Spring Boot、SQLite 应用开发与测试，保证服务稳定与数据安全。\n".repeat(8)
                + "项目经历\n完成简历识别系统。\n教育背景\n计算机科学与技术本科。";
    }
}
