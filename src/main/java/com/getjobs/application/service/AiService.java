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

import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.Base64;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;

/**
 * AI 服务（Spring 管理）
 * 从数据库配置获取 BASE_URL、API_KEY、MODEL 并发起 AI 请求。
 */
@Service
@Slf4j
@RequiredArgsConstructor
@DependsOn("profileService")
public class AiService {
    private static final int DEFAULT_API_TIMEOUT_SECONDS = 120;
    private static final int MAX_REMOTE_REQUESTS = 2;
    private static final long DEFAULT_RATE_LIMIT_DELAY_MILLIS = 500;
    private static final long MAX_RATE_LIMIT_DELAY_MILLIS = 10_000;
    private final ConfigService configService;
    private final AiMapper aiMapper;
    private final ProfileService profileService;
    private final CodexCliService codexCliService;
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
        var cfg = configService.getAiConfigs();
        if ("codex".equalsIgnoreCase(cfg.get("AI_PROVIDER"))) {
            return codexCliService.generateText(content, cfg);
        }
        String baseUrl = cfg.get("BASE_URL");
        String apiKey = cfg.get("API_KEY");
        String model = cfg.get("MODEL");
        // 根据模型类型选择兼容的端点（部分“推理/Reasoning”模型需要使用 Responses API）
        String endpoint = isResponsesModel(model)
                ? buildResponsesEndpoint(baseUrl)
                : buildChatCompletionsEndpoint(baseUrl);
        Duration timeout = requestTimeout(cfg);
        HttpClient client = buildHttpClient(timeout);
        String clientRequestId = UUID.randomUUID().toString();
        RequestBudget budget = new RequestBudget(MAX_REMOTE_REQUESTS);
        long deadlineNanos = deadlineAfter(timeout);

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

        ProviderHttpResponse response = sendRemoteJson(
                client, endpoint, apiKey, requestData, deadlineNanos, clientRequestId, budget, true);
        if (isReasoningCompatibilityStatus(response.statusCode())
                && !endpoint.endsWith("/responses")
                && containsReasoningParamError(response.body())
                && budget.hasRemaining()) {
            String fallbackEndpoint = buildResponsesEndpoint(baseUrl);
            log.warn("AI endpoint 兼容切换: clientRequestId={}, fromHost={}, toHost={}",
                    clientRequestId, endpointHost(endpoint), endpointHost(fallbackEndpoint));
            JSONObject responsesData = new JSONObject();
            responsesData.put("model", model);
            responsesData.put("temperature", 0.5);
            responsesData.put("input", content);
            response = sendRemoteJson(
                    client, fallbackEndpoint, apiKey, responsesData, deadlineNanos,
                    clientRequestId, budget, true);
            endpoint = fallbackEndpoint;
        }
        if (response.statusCode() != 200) {
            throw providerHttpError(response, endpoint, clientRequestId);
        }
        return parseTextResponse(response, endpoint, clientRequestId);
    }

    /**
     * 请求符合 JSON Schema 的结构化结果。本地 Codex CLI 使用其原生
     * --output-schema 能力；其他兼容 Provider 保持原有请求协议并由调用方继续校验结果。
     */
    public String sendStructuredRequest(String content, String outputSchema) {
        if (outputSchema == null || outputSchema.isBlank()) {
            throw new IllegalArgumentException("结构化输出 Schema 不能为空");
        }
        var cfg = configService.getAiConfigs();
        if ("codex".equalsIgnoreCase(cfg.get("AI_PROVIDER"))) {
            return codexCliService.generateStructuredText(content, outputSchema, cfg);
        }
        return sendRequest(content);
    }

    /**
     * 使用配置的视觉模型从图片简历中提取结构化文本。
     */
    public String extractResumeFromImage(byte[] imageBytes, String mimeType) {
        if (imageBytes == null || imageBytes.length == 0) {
            throw new IllegalArgumentException("图片内容不能为空");
        }
        var cfg = configService.getAiConfigs();
        if ("codex".equalsIgnoreCase(cfg.get("AI_PROVIDER"))) {
            return codexCliService.extractResumeFromImage(imageBytes, mimeType, cfg);
        }
        String baseUrl = cfg.get("BASE_URL");
        String apiKey = cfg.get("API_KEY");
        String model = cfg.get("MODEL");
        String endpoint = buildChatCompletionsEndpoint(baseUrl);
        Duration timeout = requestTimeout(cfg);
        String clientRequestId = UUID.randomUUID().toString();
        long deadlineNanos = deadlineAfter(timeout);

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

        ProviderHttpResponse response = sendRemoteJson(
                buildHttpClient(timeout), endpoint, apiKey, requestData, deadlineNanos,
                clientRequestId, new RequestBudget(MAX_REMOTE_REQUESTS), true);
        if (response.statusCode() != 200) {
            throw providerHttpError(response, endpoint, clientRequestId);
        }
        String result = parseChatContent(response, endpoint, clientRequestId);
        if (result.isBlank()) {
            throw providerResponseError(
                    AiProviderException.Code.EMPTY_RESPONSE,
                    "AI Provider 返回空内容",
                    response,
                    endpoint,
                    clientRequestId
            );
        }
        return result;
    }

    /**
     * 对本地识别结果做一次视觉复核。该方法的远程请求预算固定为 1，
     * 不切换 Provider，也不对结果未知的请求重试。
     */
    public String reviewResumeImages(List<ResumeImage> images, String localText) {
        if (images == null || images.isEmpty()) {
            throw new IllegalArgumentException("简历页面图像不能为空");
        }
        String prompt = "你是简历 OCR 复核器。请对照附件页面图像与本地识别文本，"
                + "只允许纠正错别字、补全图像中明确可见的内容、恢复正确阅读顺序。"
                + "严禁编造任何候选人经历，严禁添加图像中不存在的信息。"
                + "保留姓名、联系方式、工作经历、项目经历和教育背景的顺序，只输出复核后的纯文本。\n\n"
                + "本地识别文本：\n" + limit(localText == null ? "" : localText, 20_000);
        var cfg = configService.getAiConfigs();
        if ("codex".equalsIgnoreCase(cfg.get("AI_PROVIDER"))) {
            return codexCliService.reviewResumeImages(
                    images.stream().map(ResumeImage::bytes).toList(),
                    images.stream().map(ResumeImage::mimeType).toList(),
                    prompt,
                    cfg
            );
        }

        String endpoint = buildChatCompletionsEndpoint(cfg.get("BASE_URL"));
        Duration timeout = requestTimeout(cfg);
        String clientRequestId = UUID.randomUUID().toString();
        JSONObject requestData = new JSONObject();
        requestData.put("model", cfg.get("MODEL"));
        requestData.put("temperature", 0.1);
        JSONArray content = new JSONArray();
        content.put(new JSONObject().put("type", "text").put("text", prompt));
        for (ResumeImage image : images) {
            String mime = image.mimeType() == null || image.mimeType().isBlank() ? "image/jpeg" : image.mimeType();
            String dataUrl = "data:" + mime + ";base64," + Base64.getEncoder().encodeToString(image.bytes());
            content.put(new JSONObject()
                    .put("type", "image_url")
                    .put("image_url", new JSONObject().put("url", dataUrl)));
        }
        JSONObject message = new JSONObject().put("role", "user").put("content", content);
        requestData.put("messages", new JSONArray().put(message));
        ProviderHttpResponse response = sendRemoteJson(
                buildHttpClient(timeout), endpoint, cfg.get("API_KEY"), requestData,
                deadlineAfter(timeout), clientRequestId, new RequestBudget(1), true);
        if (response.statusCode() != 200) {
            throw providerHttpError(response, endpoint, clientRequestId);
        }
        String result = parseChatContent(response, endpoint, clientRequestId);
        if (result.isBlank()) {
            throw providerResponseError(
                    AiProviderException.Code.EMPTY_RESPONSE,
                    "AI Provider 返回空内容",
                    response,
                    endpoint,
                    clientRequestId
            );
        }
        return result;
    }

    public record ResumeImage(byte[] bytes, String mimeType) {
        public ResumeImage {
            if (bytes == null || bytes.length == 0) {
                throw new IllegalArgumentException("简历页面图像不能为空");
            }
            bytes = bytes.clone();
            mimeType = mimeType == null || mimeType.isBlank() ? "image/jpeg" : mimeType;
        }
    }

    /**
     * 根据简历生成 AI 配置草稿。这里只返回生成结果，不写数据库。
     */
    public Map<String, Object> generateResumeAiConfig(String resumeText) {
        if (resumeText == null || resumeText.trim().isEmpty()) {
            throw new IllegalArgumentException("简历内容不能为空，请先上传或粘贴简历内容");
        }

        String prompt = "你是求职自动化工具的配置助手。请根据候选人简历生成中文配置文案和岗位搜索关键词。\n" +
                "只返回JSON，不要使用Markdown代码块，不要添加解释。JSON字段必须包含 introduce, prompt, sayHi, recommendedKeywords。\n" +
                "字段要求：\n" +
                "1. introduce：第一人称技能介绍，120到260字，突出技术栈、经验、方向和优势。\n" +
                "2. prompt：用于生成Boss直聘打招呼语的模板，必须且只能包含5个%s占位符，顺序分别是技能介绍、期望岗位方向、岗位名称、岗位要求、默认打招呼语。模板要说明不匹配时只返回false。\n" +
                "3. sayHi：默认打招呼语，60字以内，第一人称，礼貌直接，适合发给HR。\n" +
                "4. recommendedKeywords：1到8个中文岗位名称组成的JSON数组，可直接用于Boss直聘和智联招聘搜索；每项优先2到12个字，覆盖候选人的核心方向并避免同义重复。\n\n" +
                "简历内容：\n" + limit(resumeText, 6000);

        String raw = sendRequest(prompt);
        JSONObject obj = new JSONObject(extractJsonObject(raw));
        String introduce = normalizeGeneratedText(obj.optString("introduce", ""));
        String promptTemplate = normalizePromptTemplate(obj.optString("prompt", ""));
        String sayHi = normalizeGeneratedText(obj.optString("sayHi", ""));
        Object keywordValue = obj.opt("recommendedKeywords");
        if (!(keywordValue instanceof JSONArray keywordArray)) {
            throw new IllegalStateException("AI返回岗位关键词格式不正确，请稍后重试");
        }
        List<String> recommendedKeywords = new java.util.ArrayList<>();
        for (int index = 0; index < keywordArray.length(); index++) {
            Object keyword = keywordArray.opt(index);
            if (keyword instanceof String) recommendedKeywords.add((String) keyword);
        }
        recommendedKeywords = JobKeywordCodec.normalize(recommendedKeywords, JobKeywordCodec.MAX_SELECTED);

        if (introduce.isEmpty() || sayHi.isEmpty() || recommendedKeywords.isEmpty()) {
            throw new IllegalStateException("AI返回内容不完整，请稍后重试");
        }
        if (countPlaceholders(promptTemplate) != 5) {
            promptTemplate = DEFAULT_GREETING_PROMPT_TEMPLATE;
        }

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("introduce", introduce);
        result.put("prompt", promptTemplate);
        result.put("sayHi", sayHi);
        result.put("recommendedKeywords", recommendedKeywords);
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

    private HttpClient buildHttpClient(Duration timeout) {
        Duration connectTimeout = timeout.compareTo(Duration.ofSeconds(30)) < 0
                ? timeout
                : Duration.ofSeconds(30);
        return HttpClient.newBuilder().connectTimeout(connectTimeout).build();
    }

    private Duration requestTimeout(Map<String, String> config) {
        String raw = config == null ? null : config.get("AI_REQUEST_TIMEOUT_SECONDS");
        try {
            int seconds = raw == null || raw.isBlank()
                    ? DEFAULT_API_TIMEOUT_SECONDS
                    : Integer.parseInt(raw.trim());
            return Duration.ofSeconds(Math.max(1, Math.min(1800, seconds)));
        } catch (NumberFormatException ignored) {
            return Duration.ofSeconds(DEFAULT_API_TIMEOUT_SECONDS);
        }
    }

    private ProviderHttpResponse sendRemoteJson(HttpClient client,
                                                String endpoint,
                                                String apiKey,
                                                JSONObject requestData,
                                                long deadlineNanos,
                                                String clientRequestId,
                                                RequestBudget budget,
                                                boolean allowRateLimitRetry) {
        boolean rateLimitRetried = false;
        while (budget.consume()) {
            Duration remaining = remainingDuration(deadlineNanos, clientRequestId);
            HttpRequest request = HttpRequest.newBuilder()
                    .uri(URI.create(endpoint))
                    .timeout(remaining)
                    .header("Content-Type", "application/json")
                    .header("Accept", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .header("api-key", apiKey)
                    .header("X-Request-ID", clientRequestId)
                    .POST(HttpRequest.BodyPublishers.ofString(requestData.toString()))
                    .build();
            try {
                HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
                ProviderHttpResponse captured = new ProviderHttpResponse(
                        response.statusCode(),
                        response.body() == null ? "" : response.body(),
                        providerRequestId(response)
                );
                if (captured.statusCode() == 429
                        && allowRateLimitRetry
                        && !rateLimitRetried
                        && budget.hasRemaining()) {
                    long delayMillis = retryAfterMillis(response);
                    if (delayMillis >= 0
                            && delayMillis <= MAX_RATE_LIMIT_DELAY_MILLIS
                            && delayMillis < remainingMillis(deadlineNanos)) {
                        rateLimitRetried = true;
                        log.warn("AI Provider 限流，执行唯一一次有界重试: clientRequestId={}, providerRequestId={}, " +
                                        "endpointHost={}, retryAfterMs={}",
                                clientRequestId, captured.providerRequestId(), endpointHost(endpoint), delayMillis);
                        sleepBeforeRetry(delayMillis, clientRequestId);
                        continue;
                    }
                }
                return captured;
            } catch (HttpTimeoutException e) {
                throw new AiProviderException(
                        AiProviderException.Code.TIMEOUT,
                        "AI Provider 请求超时，请先确认任务状态再重试（requestId=" + clientRequestId + "）",
                        null, clientRequestId, "", true, e);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                throw new AiProviderException(
                        AiProviderException.Code.NETWORK,
                        "AI Provider 请求被中断，请先确认任务状态再重试（requestId=" + clientRequestId + "）",
                        null, clientRequestId, "", true, e);
            } catch (IOException e) {
                throw new AiProviderException(
                        AiProviderException.Code.NETWORK,
                        "AI Provider 网络异常，请先确认任务状态再重试（requestId=" + clientRequestId + "）",
                        null, clientRequestId, "", true, e);
            }
        }
        throw new AiProviderException(
                AiProviderException.Code.INVALID_RESPONSE,
                "AI Provider 请求预算已耗尽（requestId=" + clientRequestId + "）",
                null, clientRequestId, "", false, null);
    }

    private long retryAfterMillis(HttpResponse<?> response) {
        String raw = response.headers().firstValue("Retry-After").orElse("").trim();
        if (raw.isEmpty()) return DEFAULT_RATE_LIMIT_DELAY_MILLIS;
        try {
            long seconds = Long.parseLong(raw);
            if (seconds < 0) return -1;
            return Math.min(Long.MAX_VALUE / 1000, seconds) * 1000;
        } catch (NumberFormatException ignored) {
            try {
                long millis = Duration.between(
                        Instant.now(),
                        ZonedDateTime.parse(raw, DateTimeFormatter.RFC_1123_DATE_TIME).toInstant()
                ).toMillis();
                return Math.max(0, millis);
            } catch (DateTimeParseException invalidDate) {
                return -1;
            }
        }
    }

    private boolean isReasoningCompatibilityStatus(int statusCode) {
        return statusCode == 400 || statusCode == 422;
    }

    private long deadlineAfter(Duration timeout) {
        return System.nanoTime() + timeout.toNanos();
    }

    private Duration remainingDuration(long deadlineNanos, String clientRequestId) {
        long remainingMillis = remainingMillis(deadlineNanos);
        if (remainingMillis <= 0) {
            throw new AiProviderException(
                    AiProviderException.Code.TIMEOUT,
                    "AI Provider 总请求时间已耗尽，请先确认任务状态再重试（requestId=" + clientRequestId + "）",
                    null, clientRequestId, "", true, null);
        }
        return Duration.ofMillis(remainingMillis);
    }

    private long remainingMillis(long deadlineNanos) {
        long remainingNanos = deadlineNanos - System.nanoTime();
        if (remainingNanos <= 0) return 0;
        return Math.max(1, Duration.ofNanos(remainingNanos).toMillis());
    }

    private void sleepBeforeRetry(long delayMillis, String clientRequestId) {
        if (delayMillis <= 0) return;
        try {
            Thread.sleep(delayMillis);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new AiProviderException(
                    AiProviderException.Code.NETWORK,
                    "AI Provider 限流等待被中断（requestId=" + clientRequestId + "）",
                    429, clientRequestId, "", false, e);
        }
    }

    private String parseTextResponse(ProviderHttpResponse response,
                                     String endpoint,
                                     String clientRequestId) {
        JSONObject responseObject = parseResponseEnvelope(response, endpoint, clientRequestId);
        String responseContent = endpoint.endsWith("/responses")
                ? extractResponsesContent(responseObject)
                : extractChatContent(responseObject);
        if (responseContent == null || responseContent.isBlank()) {
            throw providerResponseError(
                    AiProviderException.Code.EMPTY_RESPONSE,
                    "AI Provider 返回空内容",
                    response, endpoint, clientRequestId);
        }

        String responseId = responseObject.optString("id", response.providerRequestId());
        long created = responseObject.optLong("created", 0);
        String usedModel = responseObject.optString("model");
        JSONObject usageObject = responseObject.optJSONObject("usage");
        int promptTokens = usageObject != null ? usageObject.optInt("prompt_tokens", -1) : -1;
        int completionTokens = usageObject != null ? usageObject.optInt("completion_tokens", -1) : -1;
        int totalTokens = usageObject != null ? usageObject.optInt("total_tokens", -1) : -1;
        LocalDateTime createdTime = created > 0
                ? Instant.ofEpochSecond(created).atZone(ZoneId.systemDefault()).toLocalDateTime()
                : LocalDateTime.now();
        DateTimeFormatter formatter = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");
        log.info("AI响应: clientRequestId={}, providerRequestId={}, time={}, model={}, " +
                        "promptTokens={}, completionTokens={}, totalTokens={}",
                clientRequestId, responseId, createdTime.format(formatter), usedModel,
                promptTokens, completionTokens, totalTokens);
        return responseContent;
    }

    private String parseChatContent(ProviderHttpResponse response,
                                    String endpoint,
                                    String clientRequestId) {
        return extractChatContent(parseResponseEnvelope(response, endpoint, clientRequestId));
    }

    private JSONObject parseResponseEnvelope(ProviderHttpResponse response,
                                             String endpoint,
                                             String clientRequestId) {
        if (response.body() == null || response.body().isBlank()) {
            throw providerResponseError(
                    AiProviderException.Code.EMPTY_RESPONSE,
                    "AI Provider 返回空响应",
                    response, endpoint, clientRequestId);
        }
        try {
            return new JSONObject(response.body());
        } catch (RuntimeException e) {
            throw providerResponseError(
                    AiProviderException.Code.INVALID_RESPONSE,
                    "AI Provider 响应不是有效 JSON",
                    response, endpoint, clientRequestId, e);
        }
    }

    private AiProviderException providerHttpError(ProviderHttpResponse response,
                                                  String endpoint,
                                                  String clientRequestId) {
        AiProviderException.Code code = response.statusCode() == 429
                ? AiProviderException.Code.RATE_LIMITED
                : response.statusCode() >= 500
                ? AiProviderException.Code.HTTP_5XX
                : AiProviderException.Code.HTTP_4XX;
        String message = switch (code) {
            case RATE_LIMITED -> "AI Provider 请求过于频繁，请稍后显式重试";
            case HTTP_5XX -> "AI Provider 服务异常，未自动重试";
            default -> "AI Provider 拒绝了请求";
        };
        return providerResponseError(code, message, response, endpoint, clientRequestId);
    }

    private AiProviderException providerResponseError(AiProviderException.Code code,
                                                      String message,
                                                      ProviderHttpResponse response,
                                                      String endpoint,
                                                      String clientRequestId) {
        return providerResponseError(code, message, response, endpoint, clientRequestId, null);
    }

    private AiProviderException providerResponseError(AiProviderException.Code code,
                                                      String message,
                                                      ProviderHttpResponse response,
                                                      String endpoint,
                                                      String clientRequestId,
                                                      Throwable cause) {
        String body = response.body() == null ? "" : response.body();
        log.error("AI Provider 调用失败: code={}, status={}, endpointHost={}, clientRequestId={}, " +
                        "providerRequestId={}, bodyLength={}, bodyHash={}",
                code, response.statusCode(), endpointHost(endpoint), clientRequestId,
                response.providerRequestId(), body.length(), shortHash(body));
        boolean outcomeUnknown = code == AiProviderException.Code.HTTP_5XX
                || code == AiProviderException.Code.EMPTY_RESPONSE
                || code == AiProviderException.Code.INVALID_RESPONSE;
        return new AiProviderException(
                code,
                message + "（requestId=" + clientRequestId + "）",
                response.statusCode(), clientRequestId, response.providerRequestId(), outcomeUnknown, cause);
    }

    private String providerRequestId(HttpResponse<?> response) {
        return response.headers().firstValue("x-request-id")
                .or(() -> response.headers().firstValue("request-id"))
                .orElse("");
    }

    private String endpointHost(String endpoint) {
        try {
            URI uri = URI.create(endpoint);
            return uri.getHost() == null ? "unknown" : uri.getHost();
        } catch (RuntimeException ignored) {
            return "invalid";
        }
    }

    private String shortHash(String value) {
        try {
            byte[] hash = MessageDigest.getInstance("SHA-256")
                    .digest((value == null ? "" : value).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash).substring(0, 12);
        } catch (Exception ignored) {
            return "unavailable";
        }
    }

    private String extractChatContent(JSONObject responseObject) {
        try {
            JSONObject messageObject = responseObject.getJSONArray("choices")
                    .getJSONObject(0)
                    .getJSONObject("message");
            return flattenContent(messageObject.opt("content"));
        } catch (Exception ignore) {
            return "";
        }
    }

    private String extractResponsesContent(JSONObject responseObject) {
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
            String content = flattenContent(messageObject.opt("content"));
            if (content != null && !content.isBlank()) {
                return content;
            }
        } catch (Exception ignore) {
        }
        return "";
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

    private String flattenContent(Object content) {
        if (content == null) return "";
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
            return out.toString();
        }
        return String.valueOf(content);
    }

    private record ProviderHttpResponse(int statusCode, String body, String providerRequestId) {
    }

    private static final class RequestBudget {
        private int remaining;

        private RequestBudget(int remaining) {
            this.remaining = Math.max(1, remaining);
        }

        private boolean consume() {
            if (remaining <= 0) return false;
            remaining--;
            return true;
        }

        private boolean hasRemaining() {
            return remaining > 0;
        }
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
