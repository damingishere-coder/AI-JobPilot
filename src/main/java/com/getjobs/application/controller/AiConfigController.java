package com.getjobs.application.controller;

import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.dto.ResumeParseResult;
import com.getjobs.application.dto.ResumeSaveRequest;
import com.getjobs.application.service.AiService;
import com.getjobs.application.service.ChromeJobAnalysisQueueService;
import com.getjobs.application.service.JobAnalysisTaskStore;
import com.getjobs.application.service.JobAiAnalysisService;
import com.getjobs.application.service.ProfileService;
import com.getjobs.application.service.ResumeDocumentParsingService;
import lombok.Data;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;
import java.util.HashMap;
import java.util.Map;

/**
 * AI配置控制器
 * 提供AI配置管理的REST API接口
 */
@RestController
@RequestMapping("/api/ai")
@Slf4j
public class AiConfigController {


    @Autowired
    private AiService aiService;

    @Autowired
    private JobAiAnalysisService jobAiAnalysisService;

    @Autowired
    private ProfileService profileService;

    @Autowired
    private ChromeJobAnalysisQueueService chromeJobAnalysisQueueService;

    @Autowired
    private ResumeDocumentParsingService resumeDocumentParsingService;

    /**
     * 获取AI配置
     * @return AI配置信息
     */
    @GetMapping("/config")
    public ResponseEntity<Map<String, Object>> getAiConfig() {
        Map<String, Object> response = new HashMap<>();

        try {
            AiEntity aiEntity = aiService.getAiConfig();

            response.put("success", true);
            response.put("data", aiEntity);
            response.put("currentProfile", profileService.getCurrentProfile());
            response.put("hasProfile", profileService.hasProfiles());
            response.put("message", "获取AI配置成功");

            return ResponseEntity.ok(response);

        } catch (Exception e) {
            log.error("获取AI配置失败", e);
            response.put("success", false);
            response.put("message", "获取AI配置失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 保存或更新AI配置
     * @param requestBody 请求体包含介绍、提示词和岗位匹配分数线
     * @return 保存结果
     */
    @PostMapping("/config")
    public ResponseEntity<Map<String, Object>> saveAiConfig(@RequestBody AiConfigRequest requestBody) {
        Map<String, Object> response = new HashMap<>();

        try {
            String introduce = requestBody.getIntroduce();
            String prompt = requestBody.getPrompt();

            if (introduce == null || prompt == null) {
                response.put("success", false);
                response.put("message", "参数不完整，introduce和prompt不能为空");
                return ResponseEntity.badRequest().body(response);
            }

            AiEntity aiEntity = aiService.saveOrUpdateAiConfig(
                    introduce,
                    prompt,
                    requestBody.getApplyThreshold(),
                    requestBody.getPriorityApplyThreshold()
            );

            response.put("success", true);
            response.put("data", aiEntity);
            response.put("message", "保存AI配置成功");

            log.info("保存AI配置成功，ID: {}", aiEntity.getId());
            return ResponseEntity.ok(response);

        } catch (IllegalArgumentException e) {
            log.warn("AI配置参数不合法: {}", e.getMessage());
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("保存AI配置失败", e);
            response.put("success", false);
            response.put("message", "保存AI配置失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @GetMapping("/thresholds")
    public ResponseEntity<Map<String, Object>> getAiThresholds() {
        Map<String, Object> response = new HashMap<>();
        try {
            AiEntity aiEntity = aiService.getAiConfig();
            response.put("success", true);
            response.put("data", thresholdData(aiEntity));
            response.put("currentProfile", profileService.getCurrentProfile());
            response.put("hasProfile", profileService.hasProfiles());
            response.put("message", "获取AI投递分数线成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("获取AI投递分数线失败", e);
            response.put("success", false);
            response.put("message", "获取AI投递分数线失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @PostMapping("/thresholds")
    public ResponseEntity<Map<String, Object>> saveAiThresholds(@RequestBody AiThresholdRequest requestBody) {
        Map<String, Object> response = new HashMap<>();
        try {
            AiEntity aiEntity = aiService.saveOrUpdateAiThresholds(
                    requestBody.getApplyThreshold(),
                    requestBody.getPriorityApplyThreshold()
            );
            response.put("success", true);
            response.put("data", thresholdData(aiEntity));
            response.put("message", "AI投递分数线已保存");
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            log.warn("AI投递分数线参数不合法: {}", e.getMessage());
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("保存AI投递分数线失败", e);
            response.put("success", false);
            response.put("message", "保存AI投递分数线失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    private Map<String, Object> thresholdData(AiEntity aiEntity) {
        Map<String, Object> data = new HashMap<>();
        data.put("applyThreshold", aiEntity.getApplyThreshold());
        data.put("priorityApplyThreshold", aiEntity.getPriorityApplyThreshold());
        return data;
    }

    @GetMapping("/resume")
    public ResponseEntity<Map<String, Object>> getResume() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", jobAiAnalysisService.getResumeProfile());
        response.put("currentProfile", profileService.getCurrentProfile());
        response.put("hasProfile", profileService.hasProfiles());
        return ResponseEntity.ok(response);
    }

    @PostMapping(value = "/resume/parse", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> parseResume(
            @RequestParam("file") MultipartFile file,
            @RequestParam(value = "mode", defaultValue = "auto") String mode
    ) {
        Map<String, Object> response = new HashMap<>();
        try {
            ResumeParseResult result = resumeDocumentParsingService.parse(file, mode);
            response.put("success", true);
            response.put("data", result);
            response.put("message", "简历识别完成，请核对预览后再保存");
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("简历识别失败", e);
            response.put("success", false);
            response.put("message", "简历识别失败: " + e.getMessage());
            return ResponseEntity.unprocessableEntity().body(response);
        }
    }

    @PostMapping(value = "/resume", consumes = MediaType.APPLICATION_JSON_VALUE)
    public ResponseEntity<Map<String, Object>> saveResume(@RequestBody ResumeSaveRequest request) {
        Map<String, Object> response = new HashMap<>();
        try {
            String text = resumeDocumentParsingService.normalizeResumeText(request.getResumeText());
            if (text.isBlank()) {
                response.put("success", false);
                response.put("message", "简历内容不能为空，且不会覆盖已保存简历");
                return ResponseEntity.badRequest().body(response);
            }
            if (text.length() > 200_000) {
                response.put("success", false);
                response.put("message", "简历文本超过200000字符限制");
                return ResponseEntity.badRequest().body(response);
            }
            String method = request.getParseMethod() == null || request.getParseMethod().isBlank()
                    ? "manual"
                    : request.getParseMethod().trim();
            int score = request.getQualityScore() == null
                    ? resumeDocumentParsingService.qualityScore(text)
                    : Math.max(0, Math.min(100, request.getQualityScore()));
            String status = "ai-reviewed".equals(method) ? "ai_reviewed"
                    : "manual".equals(method) ? "manual" : "local_parsed";
            String message = buildResumeSaveMessage(score, request.getWarnings());
            Object data = jobAiAnalysisService.saveResumeText(
                    text,
                    safeFilename(request.getSourceFilename()),
                    status,
                    message
            );
            response.put("success", true);
            response.put("data", data);
            response.put("message", "简历已按确认后的预览文本保存");
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("保存简历失败", e);
            response.put("success", false);
            response.put("message", "保存简历失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /** 兼容旧客户端：仅在识别成功且文本非空时保存，绝不以空文本覆盖旧简历。 */
    @PostMapping(value = "/resume", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<Map<String, Object>> saveResumeLegacy(
            @RequestParam(value = "file", required = false) MultipartFile file,
            @RequestParam(value = "resumeText", required = false) String resumeText
    ) {
        Map<String, Object> response = new HashMap<>();
        try {
            String text;
            String filename = null;
            String status = "manual";
            String message = "手动保存成功";
            if (file != null && !file.isEmpty()) {
                ResumeParseResult parsed = resumeDocumentParsingService.parse(file, "auto");
                text = parsed.text();
                filename = parsed.sourceFilename();
                status = "ai-reviewed".equals(parsed.method()) ? "ai_reviewed" : "local_parsed";
                message = buildResumeSaveMessage(parsed.qualityScore(), parsed.warnings());
            } else {
                text = resumeDocumentParsingService.normalizeResumeText(resumeText);
            }
            if (text == null || text.isBlank()) {
                response.put("success", false);
                response.put("message", "简历内容不能为空，且不会覆盖已保存简历");
                return ResponseEntity.badRequest().body(response);
            }
            Object data = jobAiAnalysisService.saveResumeText(text, filename, status, message);
            response.put("success", true);
            response.put("data", data);
            response.put("message", "简历保存成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("保存简历失败", e);
            response.put("success", false);
            response.put("message", "保存简历失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    private String buildResumeSaveMessage(int qualityScore, List<String> warnings) {
        String warningText = warnings == null ? "" : warnings.stream()
                .filter(item -> item != null && !item.isBlank())
                .limit(5)
                .reduce((left, right) -> left + "；" + right)
                .orElse("");
        String result = "用户已确认识别预览；质量分 " + qualityScore;
        return warningText.isBlank() ? result : result + "；" + warningText;
    }

    private String safeFilename(String original) {
        if (original == null || original.isBlank()) return null;
        String filename = original.replace('\\', '/');
        int slash = filename.lastIndexOf('/');
        if (slash >= 0) filename = filename.substring(slash + 1);
        return filename.length() > 255 ? filename.substring(filename.length() - 255) : filename;
    }

    @PostMapping("/resume/generate-config")
    public ResponseEntity<Map<String, Object>> generateConfigFromResume(@RequestBody Map<String, String> requestBody) {
        Map<String, Object> response = new HashMap<>();
        try {
            String resumeText = requestBody.get("resumeText");
            if (resumeText == null || resumeText.trim().isEmpty()) {
                response.put("success", false);
                response.put("message", "简历内容不能为空，请先上传或粘贴简历内容");
                return ResponseEntity.badRequest().body(response);
            }

            Map<String, Object> generated = aiService.generateResumeAiConfig(resumeText);
            Object rawKeywords = generated.get("recommendedKeywords");
            List<String> keywords = rawKeywords instanceof List<?> list
                    ? list.stream().filter(String.class::isInstance).map(String.class::cast).toList()
                    : List.of();
            generated.put("recommendedKeywords", jobAiAnalysisService.saveRecommendedJobKeywords(keywords));
            response.put("success", true);
            response.put("data", generated);
            response.put("message", "AI文案和岗位关键词生成成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("根据简历生成AI文案失败", e);
            response.put("success", false);
            response.put("message", "根据简历生成AI文案失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @GetMapping("/job-keywords")
    public ResponseEntity<Map<String, Object>> getRecommendedJobKeywords() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", Map.of(
                "keywords", jobAiAnalysisService.getRecommendedJobKeywords(),
                "maxSelected", com.getjobs.application.service.JobKeywordCodec.MAX_SELECTED,
                "recommendedSelectionCount", com.getjobs.application.service.JobKeywordCodec.RECOMMENDED_SELECTION_COUNT
        ));
        response.put("currentProfile", profileService.getCurrentProfile());
        response.put("hasProfile", profileService.hasProfiles());
        return ResponseEntity.ok(response);
    }

    @GetMapping("/companies/priority")
    public ResponseEntity<Map<String, Object>> getPriorityCompanies() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("data", jobAiAnalysisService.listPriorityCompanies());
        response.put("currentProfile", profileService.getCurrentProfile());
        response.put("hasProfile", profileService.hasProfiles());
        return ResponseEntity.ok(response);
    }

    @PostMapping("/companies/priority")
    public ResponseEntity<Map<String, Object>> savePriorityCompanies(
            @RequestBody List<JobAiAnalysisService.PriorityCompanyRequest> companies
    ) {
        Map<String, Object> response = new HashMap<>();
        try {
            response.put("success", true);
            response.put("data", jobAiAnalysisService.savePriorityCompanies(companies));
            response.put("message", "优先公司名单已保存");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("保存优先公司失败", e);
            response.put("success", false);
            response.put("message", "保存优先公司失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @PostMapping("/analyze-job")
    public ResponseEntity<Map<String, Object>> analyzeJob(@RequestBody JobAiAnalysisService.JobAnalysisRequest request) {
        Map<String, Object> response = new HashMap<>();
        try {
            JobAiAnalysisService.AnalysisResult result = jobAiAnalysisService.analyzeJob(request);
            response.put("success", !result.isFailure());
            response.put("data", result);
            response.put("message", result.isFailure() ? result.getSummary() : "AI岗位分析完成");
            return result.isFailure()
                    ? ResponseEntity.status(502).body(response)
                    : ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("AI岗位分析失败", e);
            response.put("success", false);
            response.put("message", "AI岗位分析失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @GetMapping("/job-analysis/tasks")
    public ResponseEntity<Map<String, Object>> listJobAnalysisTasks(
            @RequestParam(name = "limit", defaultValue = "50") int limit
    ) {
        Map<String, Object> response = new HashMap<>();
        try {
            long profileId = profileService.getCurrentProfileId();
            response.put("success", true);
            response.put("data", chromeJobAnalysisQueueService.listTasks(profileId, limit));
            response.put("queueSize", chromeJobAnalysisQueueService.queueSize(profileId));
            response.put("message", "AI 分析任务读取成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("读取 AI 分析任务失败", e);
            response.put("success", false);
            response.put("message", "读取 AI 分析任务失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @PostMapping("/job-analysis/tasks/{taskId}/retry")
    public ResponseEntity<Map<String, Object>> retryJobAnalysisTask(
            @PathVariable long taskId,
            @RequestParam(name = "confirmUnknown", defaultValue = "false") boolean confirmUnknown
    ) {
        Map<String, Object> response = new HashMap<>();
        try {
            long profileId = profileService.getCurrentProfileId();
            JobAnalysisTaskStore.RetryResult result = chromeJobAnalysisQueueService.retry(
                    taskId, profileId, confirmUnknown);
            response.put("success", result.accepted());
            response.put("data", result.task() == null ? null : result.task().toView());
            response.put("message", result.message());
            return result.accepted()
                    ? ResponseEntity.ok(response)
                    : ResponseEntity.badRequest().body(response);
        } catch (Exception e) {
            log.error("重试 AI 分析任务失败", e);
            response.put("success", false);
            response.put("message", "重试 AI 分析任务失败: " + e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    /**
     * 健康检查接口
     * @return 服务状态
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> healthCheck() {
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("service", "AiConfigController");
        response.put("status", "healthy");
        response.put("timestamp", System.currentTimeMillis());

        return ResponseEntity.ok(response);
    }

    /**
     * AI 文本生成测试接口（GET）
     * 示例：/api/ai/chat?content=你好，帮我写一句简洁的问候语
     */
    @GetMapping("/chat")
    public ResponseEntity<Map<String, Object>> chat(@RequestParam(name = "content") String content) {
        Map<String, Object> response = new HashMap<>();
        try {
            if (content == null || content.trim().isEmpty()) {
                response.put("success", false);
                response.put("message", "content 参数不能为空");
                return ResponseEntity.badRequest().body(response);
            }

            String reply = aiService.sendRequest(content.trim());
            response.put("success", true);
            response.put("data", reply);
            response.put("message", "AI 请求成功");
            return ResponseEntity.ok(response);
        } catch (Exception e) {
            log.error("AI 请求失败", e);
            response.put("success", false);
            response.put("message", e.getMessage());
            return ResponseEntity.internalServerError().body(response);
        }
    }

    @Data
    public static class AiConfigRequest {
        private String introduce;
        private String prompt;
        private Integer applyThreshold;
        private Integer priorityApplyThreshold;
    }

    @Data
    public static class AiThresholdRequest {
        private Integer applyThreshold;
        private Integer priorityApplyThreshold;
    }
}
