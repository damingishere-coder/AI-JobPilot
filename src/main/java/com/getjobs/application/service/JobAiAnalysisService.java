package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.entity.JobAiAnalysisEntity;
import com.getjobs.application.entity.PriorityCompanyEntity;
import com.getjobs.application.entity.ResumeProfileEntity;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
import com.getjobs.application.mapper.JobAiAnalysisMapper;
import com.getjobs.application.mapper.PriorityCompanyMapper;
import com.getjobs.application.mapper.ResumeProfileMapper;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.context.annotation.DependsOn;

import java.io.ByteArrayInputStream;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class JobAiAnalysisService {
    public static final int DEFAULT_APPLY_THRESHOLD = 75;
    public static final int DEFAULT_PRIORITY_APPLY_THRESHOLD = 65;

    private final AiService aiService;
    private final ProfileService profileService;
    private final ResumeProfileMapper resumeProfileMapper;
    private final PriorityCompanyMapper priorityCompanyMapper;
    private final JobAiAnalysisMapper jobAiAnalysisMapper;
    private final BossJobDataMapper bossJobDataMapper;
    private final ZhilianJobDataMapper zhilianJobDataMapper;
    private final ConcurrentMap<Long, List<PriorityCompanyEntity>> enabledPriorityCompanyCache = new ConcurrentHashMap<>();

    @Transactional
    public ResumeProfileEntity saveResumeText(String resumeText, String sourceFilename, String status, String message) {
        Long profileId = profileService.getCurrentProfileId();
        ResumeProfileEntity current = getResumeProfile();
        LocalDateTime now = LocalDateTime.now();
        if (current == null) {
            current = new ResumeProfileEntity();
            current.setProfileId(profileId);
            current.setCreatedAt(now);
        }
        current.setProfileId(profileId);
        current.setResumeText(resumeText == null ? "" : resumeText);
        current.setSourceFilename(sourceFilename);
        current.setParseStatus(status == null ? "manual" : status);
        current.setParseMessage(message);
        current.setUpdatedAt(now);
        if (current.getId() == null) {
            resumeProfileMapper.insert(current);
        } else {
            resumeProfileMapper.updateById(current);
        }
        return current;
    }

    public ResumeProfileEntity getResumeProfile() {
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return null;
        return getResumeProfile(profileId);
    }

    public ResumeProfileEntity getResumeProfile(Long profileId) {
        if (profileId == null) return null;
        QueryWrapper<ResumeProfileEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", profileId);
        wrapper.orderByDesc("updated_at").last("LIMIT 1");
        return resumeProfileMapper.selectOne(wrapper);
    }

    public ResumeProfileEntity parseAndSaveResumeFile(MultipartFile file) {
        if (file == null || file.isEmpty()) {
            throw new IllegalArgumentException("上传文件不能为空");
        }
        String filename = file.getOriginalFilename() == null ? "resume" : file.getOriginalFilename();
        String contentType = file.getContentType() == null ? "" : file.getContentType().toLowerCase(Locale.ROOT);
        try {
            byte[] bytes = file.getBytes();
            String text;
            if (filename.toLowerCase(Locale.ROOT).endsWith(".pdf") || contentType.contains("pdf")) {
                text = extractPdfText(bytes);
                if (text == null || text.trim().isEmpty()) {
                    return saveResumeText("", filename, "empty_text_pdf", "PDF未解析到文字，可能是扫描版PDF，请粘贴文本或上传图片简历");
                }
                return saveResumeText(text, filename, "parsed", "PDF解析成功");
            }
            if (contentType.startsWith("image/") || filename.toLowerCase(Locale.ROOT).matches(".*\\.(png|jpg|jpeg|webp)$")) {
                text = aiService.extractResumeFromImage(bytes, contentType.isEmpty() ? "image/jpeg" : contentType);
                return saveResumeText(text, filename, "parsed", "图片简历已通过AI解析");
            }
            text = new String(bytes, java.nio.charset.StandardCharsets.UTF_8);
            return saveResumeText(text, filename, "parsed", "文本文件解析成功");
        } catch (Exception e) {
            log.warn("简历文件解析失败: {}", e.getMessage());
            return saveResumeText("", filename, "failed", e.getMessage());
        }
    }

    private String extractPdfText(byte[] bytes) throws Exception {
        try (PDDocument document = Loader.loadPDF(bytes)) {
            return new PDFTextStripper().getText(document).trim();
        }
    }

    @Transactional
    public List<PriorityCompanyEntity> savePriorityCompanies(List<PriorityCompanyRequest> companies) {
        Long profileId = profileService.getCurrentProfileId();
        QueryWrapper<PriorityCompanyEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", profileId);
        priorityCompanyMapper.delete(wrapper);
        LocalDateTime now = LocalDateTime.now();
        if (companies != null) {
            for (PriorityCompanyRequest req : companies) {
                String name = req == null ? null : req.getCompanyName();
                if (name == null || name.trim().isEmpty()) continue;
                PriorityCompanyEntity entity = new PriorityCompanyEntity();
                entity.setProfileId(profileId);
                entity.setCompanyName(name.trim());
                entity.setEnabled(req.getEnabled() == null || req.getEnabled() == 1 ? 1 : 0);
                entity.setRemark(req.getRemark());
                entity.setCreatedAt(now);
                entity.setUpdatedAt(now);
                priorityCompanyMapper.insert(entity);
            }
        }
        evictPriorityCompanyCache(profileId);
        return listPriorityCompanies(profileId);
    }

    public List<PriorityCompanyEntity> listPriorityCompanies() {
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return List.of();
        return listPriorityCompanies(profileId);
    }

    public List<PriorityCompanyEntity> listPriorityCompanies(Long profileId) {
        if (profileId == null) return List.of();
        QueryWrapper<PriorityCompanyEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", profileId);
        wrapper.orderByAsc("id");
        return priorityCompanyMapper.selectList(wrapper);
    }

    public boolean isPriorityCompany(String companyName) {
        return isPriorityCompany(companyName, profileService.getCurrentProfileIdOrNull());
    }

    public boolean isPriorityCompany(String companyName, Long profileId) {
        if (companyName == null || companyName.trim().isEmpty()) return false;
        String normalized = companyName.trim();
        return listEnabledPriorityCompanies(profileId).stream()
                .map(PriorityCompanyEntity::getCompanyName)
                .filter(s -> s != null && !s.trim().isEmpty())
                .anyMatch(s -> normalized.contains(s.trim()) || s.trim().contains(normalized));
    }

    public List<PriorityCompanyEntity> listEnabledPriorityCompanies(Long profileId) {
        if (profileId == null) return List.of();
        return enabledPriorityCompanyCache.computeIfAbsent(profileId, this::loadEnabledPriorityCompanies);
    }

    private List<PriorityCompanyEntity> loadEnabledPriorityCompanies(Long profileId) {
        QueryWrapper<PriorityCompanyEntity> wrapper = new QueryWrapper<>();
        wrapper.eq("profile_id", profileId)
                .and(w -> w.eq("enabled", 1).or().isNull("enabled"))
                .orderByAsc("id");
        List<PriorityCompanyEntity> rows = priorityCompanyMapper.selectList(wrapper);
        if (rows == null || rows.isEmpty()) return List.of();
        return List.copyOf(rows.stream()
                .filter(e -> e != null && (e.getEnabled() == null || e.getEnabled() == 1))
                .collect(Collectors.toList()));
    }

    private void evictPriorityCompanyCache(Long profileId) {
        if (profileId == null) {
            enabledPriorityCompanyCache.clear();
        } else {
            enabledPriorityCompanyCache.remove(profileId);
        }
    }

    public AnalysisResult analyzeJob(JobAnalysisRequest request) {
        if (request == null) throw new IllegalArgumentException("岗位分析请求不能为空");
        Long profileId = resolveAnalysisProfileId(request);
        request.setProfileId(profileId);
        markPlatformAnalysisStarted(request);
        boolean priority = isPriorityCompany(request.getCompanyName(), profileId);
        int threshold = resolveApplyThreshold(profileId, priority);
        ResumeProfileEntity resume = getResumeProfile(profileId);
        String resumeText = resume == null ? "" : resume.getResumeText();
        if (resumeText == null || resumeText.trim().isEmpty()) {
            AnalysisResult result = AnalysisResult.failed(DeliveryStatus.AI_ANALYSIS_FAILED, "请先在AI配置页保存简历内容");
            result.setPriorityCompany(priority);
            persistAnalysis(request, result, "{\"error\":\"missing resume\"}");
            updatePlatformCache(request, result);
            return result;
        }

        String prompt = buildPrompt(resumeText, request, priority, threshold);
        String raw;
        try {
            raw = aiService.sendRequest(prompt);
            AnalysisResult result = parseResult(raw);
            result.setPriorityCompany(priority);
            result.setThreshold(threshold);
            if (result.getScore() == null) result.setScore(0);
            if (result.getDecision() == null || result.getDecision().isBlank()) {
                result.setDecision(result.getScore() >= threshold ? "APPLY" : "SKIP");
            }
            if (!"APPLY".equalsIgnoreCase(result.getDecision()) && result.getScore() >= threshold) {
                result.setDecision("APPLY");
            }
            if ("APPLY".equalsIgnoreCase(result.getDecision()) && result.getScore() < threshold) {
                result.setDecision("SKIP");
            }
            persistAnalysis(request, result, raw);
            updatePlatformCache(request, result);
            return result;
        } catch (Exception e) {
            log.warn("AI岗位分析失败: {}", e.getMessage());
            AnalysisResult result = AnalysisResult.failed(DeliveryStatus.AI_ANALYSIS_FAILED, e.getMessage());
            result.setPriorityCompany(priority);
            result.setThreshold(threshold);
            persistAnalysis(request, result, "{\"error\":\"" + escape(e.getMessage()) + "\"}");
            updatePlatformCache(request, result);
            return result;
        }
    }

    public List<String> generateBossSearchKeywords(List<String> existingKeywords, int limitCount) {
        int max = Math.max(1, Math.min(limitCount <= 0 ? 5 : limitCount, 5));
        ResumeProfileEntity resume = getResumeProfile();
        String resumeText = resume == null ? "" : resume.getResumeText();
        if (resumeText == null || resumeText.trim().isEmpty()) {
            throw new IllegalArgumentException("请先在AI配置页保存简历内容");
        }
        List<String> existing = existingKeywords == null ? List.of() : existingKeywords.stream()
                .filter(s -> s != null && !s.trim().isEmpty())
                .map(String::trim)
                .distinct()
                .collect(Collectors.toList());
        String prompt = "你是 Boss 直聘搜索关键词助手。请根据候选人简历生成最多" + max + "个中文岗位搜索关键词。\n" +
                "只返回JSON数组，不要使用Markdown代码块，不要解释。关键词要适合直接填入 Boss 搜索框，优先2到8个字，避免过宽泛。\n" +
                "已配置关键词（不要重复）：\n" + new JSONArray(existing).toString() + "\n\n" +
                "简历：\n" + limit(resumeText, 5000);
        try {
            String raw = aiService.sendRequest(prompt);
            return parseKeywordArray(raw).stream()
                    .filter(s -> existing.stream().noneMatch(e -> e.equalsIgnoreCase(s)))
                    .limit(max)
                    .collect(Collectors.toList());
        } catch (Exception e) {
            log.warn("AI生成Boss关键词失败: {}", e.getMessage());
            return List.of();
        }
    }

    private String buildPrompt(String resumeText, JobAnalysisRequest request, boolean priority, int threshold) {
        return "你是求职投递决策助手。请根据候选人简历和岗位信息判断是否值得自动投递。\n" +
                "只返回JSON，不要使用Markdown代码块。JSON字段必须包含 score, decision, summary, strengths, risks, greeting。\n" +
                "score 必须是0到100之间的整数，请综合评估核心技能、工作经验、学历、地点、薪资和岗位硬性要求，不要为了达到阈值而抬高分数。\n" +
                "decision 只能是 APPLY 或 SKIP。当前公司" +
                (priority ? "是" : "不是") + "优先公司，当前阈值为" + threshold + "。\n" +
                "简历：\n" + limit(resumeText, 6000) + "\n\n" +
                "平台：" + safe(request.getPlatform()) + "\n" +
                "搜索关键词：" + safe(request.getKeyword()) + "\n" +
                "公司：" + safe(request.getCompanyName()) + "\n" +
                "岗位：" + safe(request.getJobName()) + "\n" +
                "薪资：" + safe(request.getSalary()) + "\n" +
                "地点：" + safe(request.getLocation()) + "\n" +
                "经验：" + safe(request.getExperience()) + "\n" +
                "学历：" + safe(request.getDegree()) + "\n" +
                "公司信息：" + safe(request.getCompanyInfo()) + "\n" +
                "岗位描述：\n" + limit(safe(request.getJobDescription()), 5000) + "\n";
    }

    private AnalysisResult parseResult(String raw) {
        JSONObject obj = new JSONObject(repairJsonObject(extractJson(raw)));
        AnalysisResult result = new AnalysisResult();
        result.setScore(clampScore(obj.has("score") ? obj.optInt("score") : 0));
        result.setDecision(obj.optString("decision", "SKIP"));
        result.setSummary(obj.optString("summary", ""));
        result.setStrengths(toStringList(obj.opt("strengths")));
        result.setRisks(toStringList(obj.opt("risks")));
        result.setGreeting(obj.optString("greeting", ""));
        return result;
    }

    private List<String> parseKeywordArray(String raw) {
        String json = extractJsonArray(raw);
        JSONArray arr = new JSONArray(json);
        List<String> out = new ArrayList<>();
        for (int i = 0; i < arr.length(); i++) {
            String keyword = arr.optString(i, "").trim();
            if (!keyword.isEmpty() && out.stream().noneMatch(existing -> existing.equalsIgnoreCase(keyword))) {
                out.add(keyword);
            }
        }
        return out;
    }

    private String extractJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "{}";
        String s = raw.trim();
        if (s.startsWith("```")) {
            s = s.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "").trim();
        }
        int start = s.indexOf('{');
        int end = s.lastIndexOf('}');
        if (start >= 0 && end > start) return s.substring(start, end + 1);
        return s;
    }

    private String repairJsonObject(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "{}";
        String s = raw.trim()
                .replace('\u201c', '"')
                .replace('\u201d', '"')
                .replace('\u2018', '\'')
                .replace('\u2019', '\'');
        try {
            new JSONObject(s);
            return s;
        } catch (Exception ignored) {
        }

        int start = s.indexOf('{');
        int end = s.lastIndexOf('}');
        if (start >= 0) {
            s = end > start ? s.substring(start, end + 1) : s.substring(start) + "}";
        }

        s = s.replaceAll(",\\s*([}\\]])", "$1");
        for (String key : List.of("score", "decision", "summary", "strengths", "risks", "greeting")) {
            s = s.replaceAll("(?m)([{,]\\s*)" + key + "\\s*:", "$1\"" + key + "\":");
        }
        try {
            new JSONObject(s);
            return s;
        } catch (Exception ignored) {
        }

        return fallbackJsonFromText(raw);
    }

    private String fallbackJsonFromText(String raw) {
        String text = raw == null ? "" : raw.trim();
        JSONObject obj = new JSONObject();
        obj.put("score", extractScore(text));
        obj.put("decision", extractDecision(text));
        obj.put("summary", limit(text.isEmpty() ? "AI返回格式异常，已按跳过处理" : text, 500));
        obj.put("strengths", new JSONArray());
        obj.put("risks", new JSONArray(List.of("AI返回不是标准JSON，建议检查模型输出或重试分析")));
        obj.put("greeting", "");
        return obj.toString();
    }

    private int extractScore(String text) {
        if (text == null) return 0;
        java.util.regex.Matcher matcher = java.util.regex.Pattern.compile("(?i)(score|分数|得分)\\D{0,12}(\\d{1,3})").matcher(text);
        if (matcher.find()) {
            try {
                return Math.max(0, Math.min(100, Integer.parseInt(matcher.group(2))));
            } catch (Exception ignored) {
            }
        }
        return 0;
    }

    private int clampScore(int score) {
        return Math.max(0, Math.min(100, score));
    }

    private int resolveApplyThreshold(Long profileId, boolean priority) {
        AiEntity config = aiService.getAiConfig(profileId);
        if (config == null) {
            return priority ? DEFAULT_PRIORITY_APPLY_THRESHOLD : DEFAULT_APPLY_THRESHOLD;
        }
        Integer configured = priority ? config.getPriorityApplyThreshold() : config.getApplyThreshold();
        int fallback = priority ? DEFAULT_PRIORITY_APPLY_THRESHOLD : DEFAULT_APPLY_THRESHOLD;
        return configured == null ? fallback : Math.max(0, Math.min(100, configured));
    }

    private String extractDecision(String text) {
        if (text == null) return "SKIP";
        java.util.regex.Matcher matcher = java.util.regex.Pattern
                .compile("(?i)(decision|决策)\\D{0,20}(APPLY|SKIP)")
                .matcher(text);
        return matcher.find() ? matcher.group(2).toUpperCase(Locale.ROOT) : "SKIP";
    }

    private String extractJsonArray(String raw) {
        if (raw == null || raw.trim().isEmpty()) return "[]";
        String s = raw.trim();
        if (s.startsWith("```")) {
            s = s.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "").trim();
        }
        int start = s.indexOf('[');
        int end = s.lastIndexOf(']');
        if (start >= 0 && end > start) return s.substring(start, end + 1);
        return s;
    }

    private List<String> toStringList(Object value) {
        List<String> out = new ArrayList<>();
        if (value instanceof JSONArray arr) {
            for (int i = 0; i < arr.length(); i++) out.add(arr.optString(i));
        } else if (value != null) {
            out.add(String.valueOf(value));
        }
        return out.stream().filter(s -> s != null && !s.isBlank()).collect(Collectors.toList());
    }

    private void persistAnalysis(JobAnalysisRequest request, AnalysisResult result, String raw) {
        try {
            JobAiAnalysisEntity entity = new JobAiAnalysisEntity();
            entity.setProfileId(request.getProfileId());
            entity.setPlatform(request.getPlatform());
            entity.setJobKey(request.getJobKey());
            entity.setCompanyName(request.getCompanyName());
            entity.setJobName(request.getJobName());
            entity.setScanRunId(request.getScanRunId());
            entity.setScore(result.getScore());
            entity.setDecision(result.getDecision());
            entity.setSummary(result.getSummary());
            entity.setStrengths(toJsonArray(result.getStrengths()));
            entity.setRisks(toJsonArray(result.getRisks()));
            entity.setGreeting(result.getGreeting());
            entity.setPriorityCompany(Boolean.TRUE.equals(result.getPriorityCompany()) ? 1 : 0);
            entity.setRawResponse(raw);
            entity.setCreatedAt(LocalDateTime.now());
            entity.setUpdatedAt(LocalDateTime.now());
            jobAiAnalysisMapper.insert(entity);
        } catch (Exception e) {
            log.warn("保存AI分析结果失败: {}", e.getMessage());
        }
    }

    public void updatePlatformCache(JobAnalysisRequest request, AnalysisResult result) {
        if (request == null || result == null) return;
        String reason = result.toReasonText();
        if ("boss".equalsIgnoreCase(request.getPlatform())) {
            BossJobDataEntity existing = findBossJobForAnalysis(request);
            String nextStatus = DeliveryStatus.protectDelivered(
                    existing == null ? null : existing.getDeliveryStatus(),
                    DeliveryStatus.fromAiResult(result)
            );
            BossJobDataEntity update = new BossJobDataEntity();
            update.setAiScore(result.getScore());
            update.setAiDecision(result.getDecision());
            update.setAiReason(reason);
            update.setPriorityCompany(Boolean.TRUE.equals(result.getPriorityCompany()) ? 1 : 0);
            if (request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
                update.setScanRunId(request.getScanRunId());
            }
            if (!DeliveryStatus.isDelivered(existing == null ? null : existing.getDeliveryStatus())) {
                update.setDeliveryStatus(nextStatus);
            }
            update.setUpdatedAt(LocalDateTime.now());
            bossJobDataMapper.update(update, bossUpdateWrapper(request));
        } else if ("zhilian".equalsIgnoreCase(request.getPlatform())) {
            ZhilianJobDataEntity existing = findZhilianJobForAnalysis(request);
            String nextStatus = DeliveryStatus.protectDelivered(
                    existing == null ? null : existing.getDeliveryStatus(),
                    DeliveryStatus.fromAiResult(result)
            );
            ZhilianJobDataEntity update = new ZhilianJobDataEntity();
            update.setAiScore(result.getScore());
            update.setAiDecision(result.getDecision());
            update.setAiReason(reason);
            update.setPriorityCompany(Boolean.TRUE.equals(result.getPriorityCompany()) ? 1 : 0);
            if (request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
                update.setScanRunId(request.getScanRunId());
            }
            if (request.getJobDescription() != null && !request.getJobDescription().isBlank()) {
                update.setJobDescription(request.getJobDescription());
            }
            if (!DeliveryStatus.isDelivered(existing == null ? null : existing.getDeliveryStatus())) {
                update.setDeliveryStatus(nextStatus);
            }
            update.setUpdateTime(LocalDateTime.now());
            zhilianJobDataMapper.update(update, zhilianUpdateWrapper(request));
        }
    }

    private void markPlatformAnalysisStarted(JobAnalysisRequest request) {
        if (request == null) return;
        if ("boss".equalsIgnoreCase(request.getPlatform())) {
            BossJobDataEntity existing = findBossJobForAnalysis(request);
            if (DeliveryStatus.isDelivered(existing == null ? null : existing.getDeliveryStatus())) return;
            BossJobDataEntity update = new BossJobDataEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
            update.setUpdatedAt(LocalDateTime.now());
            bossJobDataMapper.update(update, bossUpdateWrapper(request));
        } else if ("zhilian".equalsIgnoreCase(request.getPlatform())) {
            ZhilianJobDataEntity existing = findZhilianJobForAnalysis(request);
            if (DeliveryStatus.isDelivered(existing == null ? null : existing.getDeliveryStatus())) return;
            ZhilianJobDataEntity update = new ZhilianJobDataEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
            update.setUpdateTime(LocalDateTime.now());
            zhilianJobDataMapper.update(update, zhilianUpdateWrapper(request));
        }
    }

    private UpdateWrapper<BossJobDataEntity> bossUpdateWrapper(JobAnalysisRequest request) {
        UpdateWrapper<BossJobDataEntity> uw = new UpdateWrapper<>();
        if (request.getProfileId() != null) {
            uw.eq("profile_id", request.getProfileId());
        }
        if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            uw.eq("encrypt_id", request.getJobKey());
        } else {
            uw.eq("company_name", request.getCompanyName()).eq("job_name", request.getJobName());
        }
        if (request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            uw.eq("scan_run_id", request.getScanRunId());
        }
        return uw;
    }

    private UpdateWrapper<ZhilianJobDataEntity> zhilianUpdateWrapper(JobAnalysisRequest request) {
        UpdateWrapper<ZhilianJobDataEntity> uw = new UpdateWrapper<>();
        if (request.getProfileId() != null) {
            uw.eq("profile_id", request.getProfileId());
        }
        if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            uw.eq("job_id", request.getJobKey());
        } else {
            uw.eq("company_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        if (request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            uw.eq("scan_run_id", request.getScanRunId());
        }
        return uw;
    }

    private BossJobDataEntity findBossJobForAnalysis(JobAnalysisRequest request) {
        QueryWrapper<BossJobDataEntity> wrapper = new QueryWrapper<>();
        if (request.getProfileId() != null) {
            wrapper.eq("profile_id", request.getProfileId());
        }
        if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("encrypt_id", request.getJobKey());
        } else {
            wrapper.eq("company_name", request.getCompanyName()).eq("job_name", request.getJobName());
        }
        if (request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            wrapper.eq("scan_run_id", request.getScanRunId());
        }
        wrapper.last("LIMIT 1");
        return bossJobDataMapper.selectOne(wrapper);
    }

    private ZhilianJobDataEntity findZhilianJobForAnalysis(JobAnalysisRequest request) {
        QueryWrapper<ZhilianJobDataEntity> wrapper = new QueryWrapper<>();
        if (request.getProfileId() != null) {
            wrapper.eq("profile_id", request.getProfileId());
        }
        if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("job_id", request.getJobKey());
        } else {
            wrapper.eq("company_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        if (request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            wrapper.eq("scan_run_id", request.getScanRunId());
        }
        wrapper.last("LIMIT 1");
        return zhilianJobDataMapper.selectOne(wrapper);
    }

    private String toJsonArray(List<String> values) {
        JSONArray arr = new JSONArray();
        if (values != null) values.forEach(arr::put);
        return arr.toString();
    }

    private String limit(String s, int max) {
        if (s == null) return "";
        return s.length() <= max ? s : s.substring(0, max);
    }

    private String safe(String s) {
        return s == null ? "" : s;
    }

    private String escape(String s) {
        return s == null ? "" : s.replace("\"", "\\\"");
    }

    private Long resolveAnalysisProfileId(JobAnalysisRequest request) {
        if (request != null && request.getProfileId() != null) {
            return request.getProfileId();
        }
        return profileService.getCurrentProfileId();
    }

    @Data
    public static class PriorityCompanyRequest {
        private String companyName;
        private Integer enabled;
        private String remark;
    }

    @Data
    public static class JobAnalysisRequest {
        private Long profileId;
        private String platform;
        private String jobKey;
        private String keyword;
        private String companyName;
        private String jobName;
        private String salary;
        private String location;
        private String experience;
        private String degree;
        private String companyInfo;
        private String jobDescription;
        private String scanRunId;
    }

    @Data
    public static class AnalysisResult {
        private Integer score;
        private String decision;
        private String summary;
        private List<String> strengths = new ArrayList<>();
        private List<String> risks = new ArrayList<>();
        private String greeting;
        private Boolean priorityCompany;
        private Integer threshold;

        public boolean shouldApply() {
            return "APPLY".equalsIgnoreCase(decision);
        }

        public boolean isFailure() {
            return DeliveryStatus.AI_ANALYSIS_FAILED.equals(decision);
        }

        public String toReasonText() {
            Map<String, Object> map = new HashMap<>();
            map.put("summary", summary);
            map.put("strengths", strengths);
            map.put("risks", risks);
            map.put("threshold", threshold);
            return new JSONObject(map).toString();
        }

        public static AnalysisResult failed(String decision, String message) {
            AnalysisResult result = new AnalysisResult();
            result.setScore(0);
            result.setDecision(decision);
            result.setSummary(message == null ? DeliveryStatus.AI_ANALYSIS_FAILED : message);
            result.setGreeting("");
            return result;
        }
    }
}
