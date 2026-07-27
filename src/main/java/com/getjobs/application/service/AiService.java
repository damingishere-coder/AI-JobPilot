package com.getjobs.application.service;

import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.mapper.AiMapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.context.annotation.DependsOn;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;

/**
 * AI 服务（Spring 管理）
 * 从数据库配置获取 BASE_URL、API_KEY、MODEL 并发起 AI 请求。
 */
@Service
@Slf4j
@RequiredArgsConstructor
@DependsOn("profileService")
public class AiService {
    private final ConfigService configService;
    private final AiMapper aiMapper;
    private final ProfileService profileService;
    private static final String DEFAULT_GREETING_PROMPT_TEMPLATE =
            "我目前在找工作，%s。我的期望岗位方向是【%s】，我需要投递的岗位名称是【%s】，岗位要求是【%s】。" +
            "如果岗位和我的经历基本符合，请生成一段给HR的中文打招呼文本；如果完全不符合，只返回false。" +
            "请突出匹配度和优势，参考我自己的打招呼语：【%s】。只返回需要发送的内容。";

    /**
     * 发送 AI 请求（非流式）并返回回复内容。
     * @param content 用户消息内容
     * @return AI 回复文本
     */
    public String sendRequest(String content) {
        // 读取并校验配置
        var cfg = configService.getAiConfigs();
        String baseUrl = cfg.get("BASE_URL");
        String apiKey = cfg.get("API_KEY");
        String model = cfg.get("MODEL");
        // 根据模型类型选择兼容的端点（部分“推理/Reasoning”模型需要使用 Responses API）
        String endpoint = isResponsesModel(model)
                ? buildResponsesEndpoint(baseUrl)
                : buildChatCompletionsEndpoint(baseUrl);

        int timeoutInSeconds = 60;

        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(timeoutInSeconds))
                .build();

        // 构建 JSON 请求体
        JSONObject requestData = new JSONObject();
        requestData.put("model", model);
        requestData.put("temperature", 0.5);
        if (endpoint.endsWith("/responses")) {
            // Responses API 采用 input 字段
            requestData.put("input", content);
            // 如需显式控制推理强度，可按需开启：
            // JSONObject reasoning = new JSONObject();
            // reasoning.put("effort", "medium");
            // requestData.put("reasoning", reasoning);
        } else {
            // Chat Completions API 使用 messages
            JSONArray messages = new JSONArray();
            JSONObject message = new JSONObject();
            message.put("role", "user");
            message.put("content", content);
            messages.put(message);
            requestData.put("messages", messages);
        }

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                // 某些服务（例如 Azure OpenAI）需要 api-key 头，额外加一层兼容
                .header("api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(requestData.toString()))
                .build();

        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                JSONObject responseObject = new JSONObject(response.body());

                String requestId = responseObject.optString("id");
                long created = responseObject.optLong("created", 0);
                String usedModel = responseObject.optString("model");

                String responseContent = endpoint.endsWith("/responses")
                        ? extractResponsesContent(responseObject, response.body())
                        : extractChatContent(responseObject, response.body());

                JSONObject usageObject = responseObject.optJSONObject("usage");
                int promptTokens = usageObject != null ? usageObject.optInt("prompt_tokens", -1) : -1;
                int completionTokens = usageObject != null ? usageObject.optInt("completion_tokens", -1) : -1;
                int totalTokens = usageObject != null ? usageObject.optInt("total_tokens", -1) : -1;

                LocalDateTime createdTime = created > 0
                        ? Instant.ofEpochSecond(created).atZone(ZoneId.systemDefault()).toLocalDateTime()
                        : LocalDateTime.now();
                DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

                log.info("AI响应: id={}, time={}, model={}, promptTokens={}, completionTokens={}, totalTokens={}",
                        requestId, createdTime.format(formatter), usedModel, promptTokens, completionTokens, totalTokens);

                return responseContent;
            } else {
                // 更详细的错误日志，便于定位 400 问题
                log.error("AI请求失败: status={}, endpoint={}, body={}", response.statusCode(), endpoint, response.body());
                // 针对 Responses-only 模型误用 Chat Completions 的常见错误做一次自动重试
                if (!endpoint.endsWith("/responses") && containsReasoningParamError(response.body())) {
                    String fallbackEndpoint = buildResponsesEndpoint(baseUrl);
                    log.warn("检测到 reasoning 相关参数错误，自动切换到 Responses API 重试: {}", fallbackEndpoint);
                    return sendRequestViaResponses(content, apiKey, model, fallbackEndpoint);
                }
                throw new RuntimeException("AI请求失败，状态码: " + response.statusCode() + ", 详情: " + response.body());
            }
        } catch (Exception e) {
            log.error("调用AI服务异常", e);
            throw e instanceof RuntimeException ? (RuntimeException) e : new RuntimeException(e);
        }
    }

    /**
     * 使用配置的视觉模型从图片简历中提取结构化文本。
     */
    public String extractResumeFromImage(byte[] imageBytes, String mimeType) {
        if (imageBytes == null || imageBytes.length == 0) {
            throw new IllegalArgumentException("图片内容不能为空");
        }
        var cfg = configService.getAiConfigs();
        String baseUrl = cfg.get("BASE_URL");
        String apiKey = cfg.get("API_KEY");
        String model = cfg.get("MODEL");
        String endpoint = buildChatCompletionsEndpoint(baseUrl);

        String dataUrl = "data:" + (mimeType == null || mimeType.isBlank() ? "image/jpeg" : mimeType) +
                ";base64," + Base64.getEncoder().encodeToString(imageBytes);

        JSONObject requestData = new JSONObject();
        requestData.put("model", model);
        requestData.put("temperature", 0.2);

        JSONArray messages = new JSONArray();
        JSONObject message = new JSONObject();
        message.put("role", "user");
        JSONArray content = new JSONArray();
        JSONObject text = new JSONObject();
        text.put("type", "text");
        text.put("text", "请完整读取这张简历图片，提取候选人的基本信息、技能、工作经历、项目经历、教育背景，输出纯文本，不要编造。");
        JSONObject image = new JSONObject();
        image.put("type", "image_url");
        image.put("image_url", new JSONObject().put("url", dataUrl));
        content.put(text);
        content.put(image);
        message.put("content", content);
        messages.put(message);
        requestData.put("messages", messages);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .header("api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(requestData.toString()))
                .build();

        try {
            HttpClient client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(60)).build();
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() != 200) {
                log.error("图片简历解析失败: status={}, body={}", response.statusCode(), response.body());
                throw new RuntimeException("图片简历解析失败，状态码: " + response.statusCode());
            }
            JSONObject responseObject = new JSONObject(response.body());
            JSONObject messageObject = responseObject.getJSONArray("choices")
                    .getJSONObject(0)
                    .getJSONObject("message");
            return messageObject.getString("content");
        } catch (Exception e) {
            log.error("图片简历解析异常", e);
            throw e instanceof RuntimeException ? (RuntimeException) e : new RuntimeException(e);
        }
    }

    /**
     * 根据简历生成 AI 配置草稿。这里只返回生成结果，不写数据库。
     */
    public Map<String, String> generateResumeAiConfig(String resumeText) {
        if (resumeText == null || resumeText.trim().isEmpty()) {
            throw new IllegalArgumentException("简历内容不能为空，请先上传或粘贴简历内容");
        }

        String prompt = "你是求职自动化工具的配置助手。请根据候选人简历生成三段中文配置文案。\n" +
                "只返回JSON，不要使用Markdown代码块，不要添加解释。JSON字段必须包含 introduce, prompt, sayHi。\n" +
                "字段要求：\n" +
                "1. introduce：第一人称技能介绍，120到260字，突出技术栈、经验、方向和优势。\n" +
                "2. prompt：用于生成Boss直聘打招呼语的模板，必须且只能包含5个%s占位符，顺序分别是技能介绍、期望岗位方向、岗位名称、岗位要求、默认打招呼语。模板要说明不匹配时只返回false。\n" +
                "3. sayHi：默认打招呼语，60字以内，第一人称，礼貌直接，适合发给HR。\n\n" +
                "简历内容：\n" + limit(resumeText, 6000);

        String raw = sendRequest(prompt);
        JSONObject obj = new JSONObject(extractJsonObject(raw));
        String introduce = normalizeGeneratedText(obj.optString("introduce", ""));
        String promptTemplate = normalizePromptTemplate(obj.optString("prompt", ""));
        String sayHi = normalizeGeneratedText(obj.optString("sayHi", ""));

        if (introduce.isEmpty() || sayHi.isEmpty()) {
            throw new IllegalStateException("AI返回内容不完整，请稍后重试");
        }
        if (countPlaceholders(promptTemplate) != 5) {
            promptTemplate = DEFAULT_GREETING_PROMPT_TEMPLATE;
        }

        Map<String, String> result = new LinkedHashMap<>();
        result.put("introduce", introduce);
        result.put("prompt", promptTemplate);
        result.put("sayHi", sayHi);
        return result;
    }

    private String extractJsonObject(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw new IllegalStateException("AI返回为空");
        }
        String s = raw.trim();
        if (s.startsWith("```")) {
            s = s.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "").trim();
        }
        int start = s.indexOf('{');
        int end = s.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return s.substring(start, end + 1);
        }
        return s;
    }

    private String normalizeGeneratedText(String value) {
        return value == null ? "" : value.trim();
    }

    private String normalizePromptTemplate(String value) {
        String template = normalizeGeneratedText(value);
        if (template.isEmpty()) {
            return DEFAULT_GREETING_PROMPT_TEMPLATE;
        }
        StringBuilder out = new StringBuilder();
        for (int i = 0; i < template.length(); i++) {
            char ch = template.charAt(i);
            if (ch != '%') {
                out.append(ch);
                continue;
            }
            if (i + 1 < template.length() && template.charAt(i + 1) == 's') {
                out.append("%s");
                i++;
            } else if (i + 1 < template.length() && template.charAt(i + 1) == '%') {
                out.append("%%");
                i++;
            } else {
                out.append("%%");
            }
        }
        return out.toString();
    }

    private int countPlaceholders(String template) {
        int count = 0;
        for (int i = 0; i < template.length() - 1; i++) {
            if (template.charAt(i) == '%' && template.charAt(i + 1) == 's') {
                count++;
                i++;
            }
        }
        return count;
    }

    private String limit(String value, int maxLength) {
        if (value == null || value.length() <= maxLength) {
            return value == null ? "" : value;
        }
        return value.substring(0, maxLength);
    }

    private String normalizeBaseUrl(String baseUrl) {
        if (baseUrl == null) return "";
        String trimmed = baseUrl.trim();
        return trimmed.endsWith("/") ? trimmed.substring(0, trimmed.length() - 1) : trimmed;
    }

    /**
     * 根据配置构造 chat/completions 端点，避免重复拼接 /v1
     */
    private String buildChatCompletionsEndpoint(String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        // 如果 baseUrl 已经包含 /v1（常见配置为 https://api.openai.com/v1），则只拼接 /chat/completions
        if (normalized.endsWith("/v1") || normalized.contains("/v1/")) {
            return normalized + "/chat/completions";
        }
        return normalized + "/v1/chat/completions";
    }

    /**
     * 构造 Responses API 端点
     */
    private String buildResponsesEndpoint(String baseUrl) {
        String normalized = normalizeBaseUrl(baseUrl);
        if (normalized.endsWith("/v1") || normalized.contains("/v1/")) {
            return normalized + "/responses";
        }
        return normalized + "/v1/responses";
    }

    /**
     * 粗略识别需要使用 Responses API 的模型（o-系列、4.1、reasoner 等）
     */
    private boolean isResponsesModel(String model) {
        if (model == null) return false;
        String m = model.toLowerCase();
        if (m.startsWith("deepseek-")) return false;
        return m.contains("o1") || m.contains("o3") || m.contains("o4")
                || m.contains("4.1") || m.contains("reasoner")
                || m.contains("4o-mini") || m.contains("gpt-4o-mini");
    }

    /**
     * 检查错误响应中是否包含 reasoning 相关参数错误（如 reasoning.summary unsupported_value）
     */
    private boolean containsReasoningParamError(String body) {
        if (body == null) return false;
        String s = body.toLowerCase();
        return (s.contains("reasoning") && s.contains("unsupported_value"))
                || s.contains("reasoning.summary");
    }

    /**
     * 使用 Responses API 发送一次请求（用于自动降级/重试）
     */
    private String sendRequestViaResponses(String content, String apiKey, String model, String endpoint) {
        int timeoutInSeconds = 60;
        HttpClient client = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(timeoutInSeconds))
                .build();

        JSONObject requestData = new JSONObject();
        requestData.put("model", model);
        requestData.put("temperature", 0.5);
        requestData.put("input", content);

        HttpRequest request = HttpRequest.newBuilder()
                .uri(URI.create(endpoint))
                .header("Content-Type", "application/json")
                .header("Accept", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .header("api-key", apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(requestData.toString()))
                .build();

        try {
            HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
            if (response.statusCode() == 200) {
                JSONObject resp = new JSONObject(response.body());
                return extractResponsesContent(resp, response.body());
            }
            log.error("Responses API 调用失败: status={}, endpoint={}, body={}", response.statusCode(), endpoint, response.body());
            throw new RuntimeException("AI请求失败，状态码: " + response.statusCode() + ", 详情: " + response.body());
        } catch (Exception e) {
            log.error("Responses API 调用异常", e);
            throw e instanceof RuntimeException ? (RuntimeException) e : new RuntimeException(e);
        }
    }

    private String extractChatContent(JSONObject responseObject, String rawBody) {
        try {
            JSONObject messageObject = responseObject.getJSONArray("choices")
                    .getJSONObject(0)
                    .getJSONObject("message");
            return flattenContent(messageObject.opt("content"), rawBody);
        } catch (Exception ignore) {
            return rawBody;
        }
    }

    private String extractResponsesContent(JSONObject responseObject, String rawBody) {
        String outputText = responseObject.optString("output_text", null);
        if (outputText != null && !outputText.isEmpty()) {
            return outputText;
        }
        StringBuilder out = new StringBuilder();
        collectResponseOutputText(responseObject.opt("output"), out);
        if (!out.isEmpty()) {
            return out.toString();
        }
        try {
            JSONObject messageObject = responseObject.getJSONArray("choices")
                    .getJSONObject(0)
                    .getJSONObject("message");
            String content = flattenContent(messageObject.opt("content"), rawBody);
            if (content != null && !content.isBlank()) {
                return content;
            }
        } catch (Exception ignore) {
        }
        return rawBody;
    }

    private void collectResponseOutputText(Object value, StringBuilder out) {
        if (value == null) return;
        if (value instanceof JSONArray arr) {
            for (int i = 0; i < arr.length(); i++) {
                collectResponseOutputText(arr.opt(i), out);
            }
            return;
        }
        if (value instanceof JSONObject obj) {
            String type = obj.optString("type", "");
            if ("output_text".equals(type) || "text".equals(type)) {
                String text = obj.optString("text", "");
                if (!text.isBlank()) {
                    if (!out.isEmpty()) out.append("\n");
                    out.append(text);
                }
            }
            collectResponseOutputText(obj.opt("content"), out);
        }
    }

    private String flattenContent(Object content, String fallback) {
        if (content == null) return fallback;
        if (content instanceof String text) return text;
        if (content instanceof JSONArray arr) {
            StringBuilder out = new StringBuilder();
            for (int i = 0; i < arr.length(); i++) {
                Object item = arr.opt(i);
                if (item instanceof JSONObject obj) {
                    String text = obj.optString("text", obj.optString("content", ""));
                    if (!text.isBlank()) {
                        if (!out.isEmpty()) out.append("\n");
                        out.append(text);
                    }
                } else if (item != null) {
                    String text = String.valueOf(item);
                    if (!text.isBlank()) {
                        if (!out.isEmpty()) out.append("\n");
                        out.append(text);
                    }
                }
            }
            return out.isEmpty() ? fallback : out.toString();
        }
        return String.valueOf(content);
    }

    // ================= 合并的 AI 配置管理方法 =================

    /**
     * 获取当前档案的 AI 配置；不存在时只返回空草稿，不自动写入数据库。
     */
    @Transactional(readOnly = true)
    public AiEntity getAiConfig() {
        return getAiConfig(profileService.getCurrentProfileId());
    }

    /**
     * 获取指定档案的 AI 配置，旧档案未保存阈值时使用系统默认值。
     */
    @Transactional(readOnly = true)
    public AiEntity getAiConfig(Long profileId) {
        AiEntity aiEntity = aiMapper.selectOne(new QueryWrapper<AiEntity>()
                .eq("profile_id", profileId)
                .orderByDesc("id")
                .last("LIMIT 1"));
        if (aiEntity == null) {
            aiEntity = new AiEntity();
            aiEntity.setProfileId(profileId);
            aiEntity.setIntroduce("");
            aiEntity.setPrompt("");
        }
        applyDefaultThresholds(aiEntity);
        return aiEntity;
    }

    /**
     * 获取所有AI配置
     */
    @Transactional(readOnly = true)
    public java.util.List<AiEntity> getAllAiConfigs() {
        return aiMapper.selectList(null);
    }

    /**
     * 根据ID获取AI配置
     */
    @Transactional(readOnly = true)
    public AiEntity getAiConfigById(Long id) {
        return aiMapper.selectById(id);
    }

    /**
     * 保存或更新AI配置（introduce/prompt）
     */
    @Transactional
    public AiEntity saveOrUpdateAiConfig(String introduce, String prompt) {
        return saveOrUpdateAiConfig(introduce, prompt, null, null);
    }

    /**
     * 保存或更新 AI 配置以及岗位匹配分数线。
     */
    @Transactional
    public AiEntity saveOrUpdateAiConfig(
            String introduce,
            String prompt,
            Integer applyThreshold,
            Integer priorityApplyThreshold
    ) {
        Long profileId = profileService.getCurrentProfileId();
        AiEntity aiEntity = aiMapper.selectOne(new QueryWrapper<AiEntity>()
                .eq("profile_id", profileId)
                .orderByDesc("id")
                .last("LIMIT 1"));
        int nextApplyThreshold = resolveThreshold(
                applyThreshold,
                aiEntity == null ? null : aiEntity.getApplyThreshold(),
                JobAiAnalysisService.DEFAULT_APPLY_THRESHOLD
        );
        int nextPriorityApplyThreshold = resolveThreshold(
                priorityApplyThreshold,
                aiEntity == null ? null : aiEntity.getPriorityApplyThreshold(),
                JobAiAnalysisService.DEFAULT_PRIORITY_APPLY_THRESHOLD
        );
        validateThresholds(nextApplyThreshold, nextPriorityApplyThreshold);

        if (aiEntity == null) {
            aiEntity = new AiEntity();
            aiEntity.setProfileId(profileId);
            aiEntity.setIntroduce(introduce);
            aiEntity.setPrompt(prompt);
            aiEntity.setApplyThreshold(nextApplyThreshold);
            aiEntity.setPriorityApplyThreshold(nextPriorityApplyThreshold);
            aiEntity.setCreatedAt(java.time.LocalDateTime.now());
            aiEntity.setUpdatedAt(java.time.LocalDateTime.now());
            aiMapper.insert(aiEntity);
            log.info("创建新的AI配置，ID: {}", aiEntity.getId());
        } else {
            aiEntity.setProfileId(profileId);
            aiEntity.setIntroduce(introduce);
            aiEntity.setPrompt(prompt);
            aiEntity.setApplyThreshold(nextApplyThreshold);
            aiEntity.setPriorityApplyThreshold(nextPriorityApplyThreshold);
            aiEntity.setUpdatedAt(java.time.LocalDateTime.now());
            aiMapper.updateById(aiEntity);
            log.info("更新AI配置，ID: {}", aiEntity.getId());
        }

        return aiEntity;
    }

    /**
     * 只更新岗位匹配分数线，保留当前档案已经保存的介绍和提示词。
     */
    @Transactional
    public AiEntity saveOrUpdateAiThresholds(Integer applyThreshold, Integer priorityApplyThreshold) {
        AiEntity current = getAiConfig();
        return saveOrUpdateAiConfig(
                current.getIntroduce() == null ? "" : current.getIntroduce(),
                current.getPrompt() == null ? "" : current.getPrompt(),
                applyThreshold,
                priorityApplyThreshold
        );
    }

    private void applyDefaultThresholds(AiEntity aiEntity) {
        if (aiEntity.getApplyThreshold() == null) {
            aiEntity.setApplyThreshold(JobAiAnalysisService.DEFAULT_APPLY_THRESHOLD);
        }
        if (aiEntity.getPriorityApplyThreshold() == null) {
            aiEntity.setPriorityApplyThreshold(JobAiAnalysisService.DEFAULT_PRIORITY_APPLY_THRESHOLD);
        }
    }

    private int resolveThreshold(Integer requested, Integer existing, int defaultValue) {
        if (requested != null) return requested;
        if (existing != null) return existing;
        return defaultValue;
    }

    private void validateThresholds(int applyThreshold, int priorityApplyThreshold) {
        if (applyThreshold < 0 || applyThreshold > 100) {
            throw new IllegalArgumentException("普通公司分数线必须是0到100之间的整数");
        }
        if (priorityApplyThreshold < 0 || priorityApplyThreshold > 100) {
            throw new IllegalArgumentException("优先公司分数线必须是0到100之间的整数");
        }
        if (priorityApplyThreshold > applyThreshold) {
            throw new IllegalArgumentException("优先公司分数线不能高于普通公司分数线");
        }
    }

    /**
     * 删除AI配置
     */
    @Transactional
    public boolean deleteAiConfig(Long id) {
        int result = aiMapper.deleteById(id);
        if (result > 0) {
            log.info("删除AI配置成功，ID: {}", id);
            return true;
        }
        return false;
    }

    /**
     * 创建默认配置
     */
    @Transactional
    protected AiEntity createDefaultConfig() {
        AiEntity aiEntity = new AiEntity();
        aiEntity.setProfileId(profileService.getCurrentProfileId());
        aiEntity.setIntroduce("请在此填写您的技能介绍");
        aiEntity.setPrompt("请在此填写AI提示词模板");
        aiEntity.setApplyThreshold(JobAiAnalysisService.DEFAULT_APPLY_THRESHOLD);
        aiEntity.setPriorityApplyThreshold(JobAiAnalysisService.DEFAULT_PRIORITY_APPLY_THRESHOLD);
        aiEntity.setCreatedAt(java.time.LocalDateTime.now());
        aiEntity.setUpdatedAt(java.time.LocalDateTime.now());
        aiMapper.insert(aiEntity);
        log.info("创建默认AI配置，ID: {}", aiEntity.getId());
        return aiEntity;
    }
}
