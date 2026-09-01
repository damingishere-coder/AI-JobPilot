package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.entity.JobAiAnalysisEntity;
import com.getjobs.application.entity.LiepinEntity;
import com.getjobs.application.entity.Job51Entity;
import com.getjobs.application.entity.PriorityCompanyEntity;
import com.getjobs.application.entity.ResumeProfileEntity;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
import com.getjobs.application.mapper.JobAiAnalysisMapper;
import com.getjobs.application.mapper.LiepinMapper;
import com.getjobs.application.mapper.Job51Mapper;
import com.getjobs.application.mapper.PriorityCompanyMapper;
import com.getjobs.application.mapper.ResumeProfileMapper;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.context.annotation.DependsOn;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.Base64;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.BooleanSupplier;
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
    private final LiepinMapper liepinMapper;
    private final Job51Mapper job51Mapper;
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
        return analyzeJob(request, () -> true, action -> {
            action.run();
            return true;
        });
    }

    public AnalysisResult analyzeJob(JobAnalysisRequest request,
                                     BooleanSupplier leaseIsCurrent,
                                     LeaseWriteGuard leaseWriteGuard) {
        if (request == null) throw new IllegalArgumentException("岗位分析请求不能为空");
        if (!isLeaseCurrent(leaseIsCurrent)) return AnalysisResult.staleLease();
        Long profileId = resolveAnalysisProfileId(request);
        request.setProfileId(profileId);
        if (!isLeaseCurrent(leaseIsCurrent)) return AnalysisResult.staleLease();
        AtomicBoolean platformReserved = new AtomicBoolean();
        if (!executeLeaseWrite(leaseWriteGuard,
                () -> platformReserved.set(markPlatformAnalysisStarted(request)))) {
            return AnalysisResult.staleLease();
        }
        if (!platformReserved.get()) {
            return AnalysisResult.failed(
                    DeliveryStatus.AI_ANALYSIS_FAILED,
                    "岗位状态已变化或岗位不存在，未调用 AI Provider"
            );
        }
        boolean priority = isPriorityCompany(request.getCompanyName(), profileId);
        int threshold = resolveApplyThreshold(profileId, priority);
        ResumeProfileEntity resume = getResumeProfile(profileId);
        String resumeText = resume == null ? "" : resume.getResumeText();
        if (resumeText == null || resumeText.trim().isEmpty()) {
            if (!isLeaseCurrent(leaseIsCurrent)) return AnalysisResult.staleLease();
            AnalysisResult result = AnalysisResult.failed(DeliveryStatus.AI_ANALYSIS_FAILED, "请先在AI配置页保存简历内容");
            result.setErrorCode("AI_RESUME_MISSING");
            result.setPriorityCompany(priority);
            AtomicReference<AnalysisResult> storedResult = new AtomicReference<>(result);
            if (!executeLeaseWrite(leaseWriteGuard, () -> {
                storedResult.set(persistAndUpdate(
                        request, result, "{\"errorCode\":\"AI_RESUME_MISSING\"}", false));
            })) {
                return AnalysisResult.staleLease();
            }
            return storedResult.get();
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
            if (!isLeaseCurrent(leaseIsCurrent)) return AnalysisResult.staleLease();
            AtomicReference<AnalysisResult> storedResult = new AtomicReference<>(result);
            if (!executeLeaseWrite(leaseWriteGuard, () -> {
                storedResult.set(persistAndUpdate(
                        request, result, responseDiagnostic(raw), true));
            })) {
                return AnalysisResult.staleLease();
            }
            return storedResult.get();
        } catch (Exception e) {
            log.warn("AI岗位分析失败: {}", e.getMessage());
            if (!isLeaseCurrent(leaseIsCurrent)) return AnalysisResult.staleLease();
            AnalysisResult result = AnalysisResult.failed(DeliveryStatus.AI_ANALYSIS_FAILED, e.getMessage());
            result.setErrorCode(errorCode(e));
            result.setProviderOutcomeUnknown(
                    e instanceof AiProviderException providerError && providerError.isOutcomeUnknown());
            result.setPriorityCompany(priority);
            result.setThreshold(threshold);
            AtomicReference<AnalysisResult> storedResult = new AtomicReference<>(result);
            if (!executeLeaseWrite(leaseWriteGuard, () -> {
                storedResult.set(persistAndUpdate(
                        request, result, errorDiagnostic(e), true));
            })) {
                return AnalysisResult.staleLease();
            }
            return storedResult.get();
        }
    }

    private boolean isLeaseCurrent(BooleanSupplier leaseIsCurrent) {
        if (leaseIsCurrent == null) return false;
        try {
            return leaseIsCurrent.getAsBoolean();
        } catch (RuntimeException e) {
            log.warn("验证 AI 分析任务租约失败，保守停止结果写入: {}", e.getMessage());
            return false;
        }
    }

    private boolean executeLeaseWrite(LeaseWriteGuard leaseWriteGuard, Runnable action) {
        if (leaseWriteGuard == null || action == null) return false;
        try {
            return leaseWriteGuard.execute(action);
        } catch (RuntimeException e) {
            log.warn("AI 分析结果的租约事务失败，保守停止结果写入: {}", e.getMessage());
            return false;
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
        String raw = aiService.sendRequest(prompt);
        return parseKeywordArray(raw).stream()
                .filter(s -> existing.stream().noneMatch(e -> e.equalsIgnoreCase(s)))
                .limit(max)
                .collect(Collectors.toList());
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
        for (String field : List.of("score", "decision", "summary", "strengths", "risks", "greeting")) {
            if (!obj.has(field) || obj.isNull(field)) {
                throw outputError("AI_OUTPUT_MISSING_FIELD", "AI 返回缺少字段: " + field, raw);
            }
        }
        Object scoreValue = obj.opt("score");
        if (!(scoreValue instanceof Number number)
                || number.doubleValue() != Math.rint(number.doubleValue())
                || number.intValue() < 0
                || number.intValue() > 100) {
            throw outputError("AI_OUTPUT_INVALID_SCORE", "AI 返回 score 必须是 0 到 100 的整数", raw);
        }
        String decision = obj.optString("decision", "").trim().toUpperCase(Locale.ROOT);
        if (!"APPLY".equals(decision) && !"SKIP".equals(decision)) {
            throw outputError("AI_OUTPUT_INVALID_DECISION", "AI 返回 decision 必须是 APPLY 或 SKIP", raw);
        }
        if (!(obj.opt("summary") instanceof String summary) || summary.isBlank()) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回 summary 不能为空", raw);
        }
        if (!(obj.opt("strengths") instanceof JSONArray strengths)
                || !(obj.opt("risks") instanceof JSONArray risks)
                || !(obj.opt("greeting") instanceof String)) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回字段类型不符合约定", raw);
        }
        if (!containsOnlyStrings(strengths) || !containsOnlyStrings(risks)) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回 strengths/risks 必须是字符串数组", raw);
        }
        AnalysisResult result = new AnalysisResult();
        result.setScore(number.intValue());
        result.setDecision(decision);
        result.setSummary(summary);
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
            Object value = arr.opt(i);
            if (!(value instanceof String)) {
                throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回的搜索关键词必须是字符串数组", raw);
            }
            String keyword = ((String) value).trim();
            if (!keyword.isEmpty() && out.stream().noneMatch(existing -> existing.equalsIgnoreCase(keyword))) {
                out.add(keyword);
            }
        }
        return out;
    }

    private String extractJson(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw outputError("AI_OUTPUT_EMPTY", "AI 返回空内容", raw);
        }
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
        if (raw == null || raw.trim().isEmpty()) {
            throw outputError("AI_OUTPUT_EMPTY", "AI 返回空内容", raw);
        }
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

        throw outputError("AI_OUTPUT_INVALID_JSON", "AI 返回无法修复为有效 JSON", raw);
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

    private String extractJsonArray(String raw) {
        if (raw == null || raw.trim().isEmpty()) {
            throw outputError("AI_OUTPUT_EMPTY", "AI 返回空内容", raw);
        }
        String s = raw.trim();
        if (s.startsWith("```")) {
            s = s.replaceFirst("^```[a-zA-Z]*\\s*", "").replaceFirst("\\s*```$", "").trim();
        }
        int start = s.indexOf('[');
        int end = s.lastIndexOf(']');
        if (start >= 0 && end > start) return s.substring(start, end + 1);
        return s;
    }

    private boolean containsOnlyStrings(JSONArray values) {
        for (int i = 0; i < values.length(); i++) {
            if (!(values.opt(i) instanceof String)) return false;
        }
        return true;
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

    private AnalysisResult persistAndUpdate(JobAnalysisRequest request,
                                            AnalysisResult result,
                                            String diagnostic,
                                            boolean providerWasCalled) {
        if (!persistAnalysis(request, result, diagnostic)) {
            AnalysisResult failure = AnalysisResult.failed(
                    DeliveryStatus.AI_ANALYSIS_FAILED,
                    "AI 分析结果持久化失败，任务未标记成功"
            );
            failure.setErrorCode("AI_PERSISTENCE_FAILED");
            failure.setProviderOutcomeUnknown(providerWasCalled);
            failure.setPriorityCompany(result.getPriorityCompany());
            failure.setThreshold(result.getThreshold());
            if (!updatePlatformCache(request, failure)) {
                safelyResetAnalyzingStatus(request, failure.getSummary());
            }
            return failure;
        }
        if (!updatePlatformCache(request, result)) {
            AnalysisResult failure = AnalysisResult.failed(
                    DeliveryStatus.AI_ANALYSIS_FAILED,
                    "AI 结果已生成，但岗位状态写回失败，需要人工对账"
            );
            failure.setErrorCode("AI_PLATFORM_WRITE_FAILED");
            failure.setProviderOutcomeUnknown(providerWasCalled);
            failure.setPriorityCompany(result.getPriorityCompany());
            failure.setThreshold(result.getThreshold());
            safelyResetAnalyzingStatus(request, failure.getSummary());
            return failure;
        }
        return result;
    }

    private void safelyResetAnalyzingStatus(JobAnalysisRequest request, String reason) {
        try {
            markAnalysisInterrupted(request, reason);
        } catch (RuntimeException recoveryError) {
            log.warn("AI 岗位状态写回失败后的安全复位也失败: platform={}, rowId={}, error={}",
                    request.getPlatform(), request.getJobRowId(), recoveryError.getMessage());
        }
    }

    private boolean persistAnalysis(JobAnalysisRequest request, AnalysisResult result, String diagnostic) {
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
            entity.setRawResponse(diagnostic);
            entity.setCreatedAt(LocalDateTime.now());
            entity.setUpdatedAt(LocalDateTime.now());
            return jobAiAnalysisMapper.insert(entity) == 1;
        } catch (Exception e) {
            log.warn("保存AI分析结果失败: {}", e.getMessage());
            return false;
        }
    }

    public boolean updatePlatformCache(JobAnalysisRequest request, AnalysisResult result) {
        if (request == null || result == null) return false;
        try {
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
                if (existing == null || !DeliveryStatus.isFinalStatus(existing.getDeliveryStatus())) {
                    update.setDeliveryStatus(nextStatus);
                }
                update.setUpdatedAt(LocalDateTime.now());
                UpdateWrapper<BossJobDataEntity> wrapper = bossUpdateWrapper(request);
                applyExpectedBossStatus(wrapper, existing);
                return bossJobDataMapper.update(update, wrapper) == 1;
            }
            if ("zhilian".equalsIgnoreCase(request.getPlatform())) {
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
                if (existing == null || !DeliveryStatus.isFinalStatus(existing.getDeliveryStatus())) {
                    update.setDeliveryStatus(nextStatus);
                }
                update.setUpdateTime(LocalDateTime.now());
                UpdateWrapper<ZhilianJobDataEntity> wrapper = zhilianUpdateWrapper(request);
                applyExpectedZhilianStatus(wrapper, existing);
                return zhilianJobDataMapper.update(update, wrapper) == 1;
            }
            if ("liepin".equalsIgnoreCase(request.getPlatform())) {
                LiepinEntity existing = findLiepinJobForAnalysis(request);
                String nextStatus = DeliveryStatus.protectDelivered(
                        existing == null ? null : existing.getDeliveryStatus(),
                        DeliveryStatus.fromAiResult(result));
                LiepinEntity update = new LiepinEntity();
                update.setAiScore(result.getScore());
                update.setAiDecision(result.getDecision());
                update.setAiReason(reason);
                update.setPriorityCompany(Boolean.TRUE.equals(result.getPriorityCompany()) ? 1 : 0);
                if (existing == null || !DeliveryStatus.isFinalStatus(existing.getDeliveryStatus())) {
                    update.setDeliveryStatus(nextStatus);
                }
                update.setUpdateTime(LocalDateTime.now());
                UpdateWrapper<LiepinEntity> wrapper = liepinUpdateWrapper(request);
                applyExpectedLegacyStatus(wrapper, existing == null ? null : existing.getDeliveryStatus());
                return liepinMapper.update(update, wrapper) == 1;
            }
            if ("51job".equalsIgnoreCase(request.getPlatform())) {
                Job51Entity existing = findJob51ForAnalysis(request);
                String nextStatus = DeliveryStatus.protectDelivered(
                        existing == null ? null : existing.getDeliveryStatus(),
                        DeliveryStatus.fromAiResult(result));
                Job51Entity update = new Job51Entity();
                update.setAiScore(result.getScore());
                update.setAiDecision(result.getDecision());
                update.setAiReason(reason);
                update.setPriorityCompany(Boolean.TRUE.equals(result.getPriorityCompany()) ? 1 : 0);
                if (existing == null || !DeliveryStatus.isFinalStatus(existing.getDeliveryStatus())) {
                    update.setDeliveryStatus(nextStatus);
                }
                update.setUpdateTime(LocalDateTime.now().toString());
                UpdateWrapper<Job51Entity> wrapper = job51UpdateWrapper(request);
                applyExpectedLegacyStatus(wrapper, existing == null ? null : existing.getDeliveryStatus());
                return job51Mapper.update(update, wrapper) == 1;
            }
            return false;
        } catch (RuntimeException e) {
            log.warn("写回 AI 平台状态失败: platform={}, rowId={}, error={}",
                    request.getPlatform(), request.getJobRowId(), e.getMessage());
            return false;
        }
    }

    /**
     * 只读取平台兼容状态，用于进程重启后判断过期租约是否已经完成结果写回。
     */
    public PlatformAnalysisState inspectPlatformAnalysis(JobAnalysisRequest request) {
        if (request == null) return PlatformAnalysisState.incomplete("MISSING_REQUEST");
        if ("boss".equalsIgnoreCase(request.getPlatform())) {
            BossJobDataEntity existing = findBossJobForAnalysis(request);
            if (existing == null) return PlatformAnalysisState.incomplete("MISSING_JOB");
            return platformAnalysisState(existing.getDeliveryStatus());
        }
        if ("zhilian".equalsIgnoreCase(request.getPlatform())) {
            ZhilianJobDataEntity existing = findZhilianJobForAnalysis(request);
            if (existing == null) return PlatformAnalysisState.incomplete("MISSING_JOB");
            return platformAnalysisState(existing.getDeliveryStatus());
        }
        if ("liepin".equalsIgnoreCase(request.getPlatform())) {
            LiepinEntity existing = findLiepinJobForAnalysis(request);
            if (existing == null) return PlatformAnalysisState.incomplete("MISSING_JOB");
            return platformAnalysisState(existing.getDeliveryStatus());
        }
        if ("51job".equalsIgnoreCase(request.getPlatform())) {
            Job51Entity existing = findJob51ForAnalysis(request);
            if (existing == null) return PlatformAnalysisState.incomplete("MISSING_JOB");
            return platformAnalysisState(existing.getDeliveryStatus());
        }
        return PlatformAnalysisState.incomplete("UNSUPPORTED_PLATFORM");
    }

    /**
     * 仅把仍停留在 AI_ANALYZING 的岗位转成明确失败；不会覆盖投递锁或已落库的 AI 结果。
     */
    public boolean markAnalysisInterrupted(JobAnalysisRequest request, String reason) {
        if (request == null) return false;
        String message = reason == null || reason.isBlank()
                ? "AI 分析被中断，结果未知"
                : reason.trim();
        if ("boss".equalsIgnoreCase(request.getPlatform())) {
            BossJobDataEntity update = new BossJobDataEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiDecision(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiReason(message);
            update.setUpdatedAt(LocalDateTime.now());
            UpdateWrapper<BossJobDataEntity> wrapper = bossUpdateWrapper(request);
            wrapper.eq("delivery_status", DeliveryStatus.AI_ANALYZING);
            return bossJobDataMapper.update(update, wrapper) == 1;
        }
        if ("zhilian".equalsIgnoreCase(request.getPlatform())) {
            ZhilianJobDataEntity update = new ZhilianJobDataEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiDecision(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiReason(message);
            update.setUpdateTime(LocalDateTime.now());
            UpdateWrapper<ZhilianJobDataEntity> wrapper = zhilianUpdateWrapper(request);
            wrapper.eq("delivery_status", DeliveryStatus.AI_ANALYZING);
            return zhilianJobDataMapper.update(update, wrapper) == 1;
        }
        if ("liepin".equalsIgnoreCase(request.getPlatform())) {
            LiepinEntity update = new LiepinEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiDecision(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiReason(message);
            update.setUpdateTime(LocalDateTime.now());
            UpdateWrapper<LiepinEntity> wrapper = liepinUpdateWrapper(request);
            wrapper.eq("delivery_status", DeliveryStatus.AI_ANALYZING);
            return liepinMapper.update(update, wrapper) == 1;
        }
        if ("51job".equalsIgnoreCase(request.getPlatform())) {
            Job51Entity update = new Job51Entity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiDecision(DeliveryStatus.AI_ANALYSIS_FAILED);
            update.setAiReason(message);
            update.setUpdateTime(LocalDateTime.now().toString());
            UpdateWrapper<Job51Entity> wrapper = job51UpdateWrapper(request);
            wrapper.eq("delivery_status", DeliveryStatus.AI_ANALYZING);
            return job51Mapper.update(update, wrapper) == 1;
        }
        return false;
    }

    private PlatformAnalysisState platformAnalysisState(String status) {
        String normalizedStatus = status == null ? "" : status.trim();
        if (DeliveryStatus.AI_ANALYZING.equals(normalizedStatus)) {
            return PlatformAnalysisState.incomplete(normalizedStatus);
        }
        boolean failed = DeliveryStatus.AI_ANALYSIS_FAILED.equals(normalizedStatus);
        boolean completed = failed
                || DeliveryStatus.WAITING_CONFIRM.equals(normalizedStatus)
                || DeliveryStatus.AI_NOT_MATCH.equals(normalizedStatus);
        return new PlatformAnalysisState(completed, failed,
                normalizedStatus.isBlank() ? "NO_STATUS" : normalizedStatus);
    }

    private boolean markPlatformAnalysisStarted(JobAnalysisRequest request) {
        if (request == null) return false;
        if ("boss".equalsIgnoreCase(request.getPlatform())) {
            if (request.getJobRowId() != null) {
                BossJobDataEntity update = new BossJobDataEntity();
                update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
                update.setUpdatedAt(LocalDateTime.now());
                UpdateWrapper<BossJobDataEntity> wrapper = bossUpdateWrapper(request);
                wrapper.and(w -> w.in("delivery_status", List.of(
                                DeliveryStatus.NOT_DELIVERED,
                                DeliveryStatus.LIST_COLLECTED,
                                DeliveryStatus.AI_ANALYSIS_FAILED
                        ))
                        .or()
                        .isNull("delivery_status"));
                return bossJobDataMapper.update(update, wrapper) == 1;
            }
            BossJobDataEntity existing = findBossJobForAnalysis(request);
            if (DeliveryStatus.isDeliveryLocked(existing == null ? null : existing.getDeliveryStatus())) return false;
            BossJobDataEntity update = new BossJobDataEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
            update.setUpdatedAt(LocalDateTime.now());
            bossJobDataMapper.update(update, bossUpdateWrapper(request));
            return true;
        } else if ("zhilian".equalsIgnoreCase(request.getPlatform())) {
            if (request.getJobRowId() != null) {
                ZhilianJobDataEntity update = new ZhilianJobDataEntity();
                update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
                update.setUpdateTime(LocalDateTime.now());
                UpdateWrapper<ZhilianJobDataEntity> wrapper = zhilianUpdateWrapper(request);
                wrapper.and(w -> w.in("delivery_status", List.of(
                                DeliveryStatus.NOT_DELIVERED,
                                DeliveryStatus.LIST_COLLECTED,
                                DeliveryStatus.AI_ANALYSIS_FAILED
                        ))
                        .or()
                        .isNull("delivery_status"));
                return zhilianJobDataMapper.update(update, wrapper) == 1;
            }
            ZhilianJobDataEntity existing = findZhilianJobForAnalysis(request);
            if (DeliveryStatus.isDeliveryLocked(existing == null ? null : existing.getDeliveryStatus())) return false;
            ZhilianJobDataEntity update = new ZhilianJobDataEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
            update.setUpdateTime(LocalDateTime.now());
            zhilianJobDataMapper.update(update, zhilianUpdateWrapper(request));
            return true;
        } else if ("liepin".equalsIgnoreCase(request.getPlatform())) {
            LiepinEntity update = new LiepinEntity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
            update.setUpdateTime(LocalDateTime.now());
            UpdateWrapper<LiepinEntity> wrapper = liepinUpdateWrapper(request);
            wrapper.and(w -> w.in("delivery_status", List.of(
                            DeliveryStatus.NOT_DELIVERED,
                            DeliveryStatus.LIST_COLLECTED,
                            DeliveryStatus.AI_ANALYSIS_FAILED
                    )).or().isNull("delivery_status"));
            return liepinMapper.update(update, wrapper) == 1;
        } else if ("51job".equalsIgnoreCase(request.getPlatform())) {
            Job51Entity update = new Job51Entity();
            update.setDeliveryStatus(DeliveryStatus.AI_ANALYZING);
            update.setUpdateTime(LocalDateTime.now().toString());
            UpdateWrapper<Job51Entity> wrapper = job51UpdateWrapper(request);
            wrapper.and(w -> w.in("delivery_status", List.of(
                            DeliveryStatus.NOT_DELIVERED,
                            DeliveryStatus.LIST_COLLECTED,
                            DeliveryStatus.AI_ANALYSIS_FAILED
                    )).or().isNull("delivery_status"));
            return job51Mapper.update(update, wrapper) == 1;
        }
        return request.getJobRowId() == null;
    }

    private void applyExpectedBossStatus(UpdateWrapper<BossJobDataEntity> wrapper,
                                         BossJobDataEntity existing) {
        if (existing == null) return;
        if (existing.getDeliveryStatus() == null) {
            wrapper.isNull("delivery_status");
        } else {
            wrapper.eq("delivery_status", existing.getDeliveryStatus());
        }
    }

    private void applyExpectedZhilianStatus(UpdateWrapper<ZhilianJobDataEntity> wrapper,
                                            ZhilianJobDataEntity existing) {
        if (existing == null) return;
        if (existing.getDeliveryStatus() == null) {
            wrapper.isNull("delivery_status");
        } else {
            wrapper.eq("delivery_status", existing.getDeliveryStatus());
        }
    }

    private <T> void applyExpectedLegacyStatus(UpdateWrapper<T> wrapper, String existingStatus) {
        if (existingStatus == null) {
            wrapper.isNull("delivery_status");
        } else {
            wrapper.eq("delivery_status", existingStatus);
        }
    }

    private UpdateWrapper<BossJobDataEntity> bossUpdateWrapper(JobAnalysisRequest request) {
        UpdateWrapper<BossJobDataEntity> uw = new UpdateWrapper<>();
        if (request.getProfileId() != null) {
            uw.eq("profile_id", request.getProfileId());
        }
        if (request.getJobRowId() != null) {
            uw.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            uw.eq("encrypt_id", request.getJobKey());
        } else {
            uw.eq("company_name", request.getCompanyName()).eq("job_name", request.getJobName());
        }
        if (request.getJobRowId() == null && request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            uw.eq("scan_run_id", request.getScanRunId());
        }
        return uw;
    }

    private UpdateWrapper<ZhilianJobDataEntity> zhilianUpdateWrapper(JobAnalysisRequest request) {
        UpdateWrapper<ZhilianJobDataEntity> uw = new UpdateWrapper<>();
        if (request.getProfileId() != null) {
            uw.eq("profile_id", request.getProfileId());
        }
        if (request.getJobRowId() != null) {
            uw.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            uw.eq("job_id", request.getJobKey());
        } else {
            uw.eq("company_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        if (request.getJobRowId() == null && request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            uw.eq("scan_run_id", request.getScanRunId());
        }
        return uw;
    }

    private UpdateWrapper<LiepinEntity> liepinUpdateWrapper(JobAnalysisRequest request) {
        UpdateWrapper<LiepinEntity> wrapper = new UpdateWrapper<>();
        if (request.getProfileId() != null) wrapper.eq("profile_id", request.getProfileId());
        if (request.getJobRowId() != null) {
            wrapper.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("job_id", request.getJobKey());
        } else {
            wrapper.eq("comp_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        return wrapper;
    }

    private UpdateWrapper<Job51Entity> job51UpdateWrapper(JobAnalysisRequest request) {
        UpdateWrapper<Job51Entity> wrapper = new UpdateWrapper<>();
        if (request.getProfileId() != null) wrapper.eq("profile_id", request.getProfileId());
        if (request.getJobRowId() != null) {
            wrapper.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("job_id", request.getJobKey());
        } else {
            wrapper.eq("comp_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        return wrapper;
    }

    private BossJobDataEntity findBossJobForAnalysis(JobAnalysisRequest request) {
        QueryWrapper<BossJobDataEntity> wrapper = new QueryWrapper<>();
        if (request.getProfileId() != null) {
            wrapper.eq("profile_id", request.getProfileId());
        }
        if (request.getJobRowId() != null) {
            wrapper.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("encrypt_id", request.getJobKey());
        } else {
            wrapper.eq("company_name", request.getCompanyName()).eq("job_name", request.getJobName());
        }
        if (request.getJobRowId() == null && request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
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
        if (request.getJobRowId() != null) {
            wrapper.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("job_id", request.getJobKey());
        } else {
            wrapper.eq("company_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        if (request.getJobRowId() == null && request.getScanRunId() != null && !request.getScanRunId().isBlank()) {
            wrapper.eq("scan_run_id", request.getScanRunId());
        }
        wrapper.last("LIMIT 1");
        return zhilianJobDataMapper.selectOne(wrapper);
    }

    private LiepinEntity findLiepinJobForAnalysis(JobAnalysisRequest request) {
        QueryWrapper<LiepinEntity> wrapper = new QueryWrapper<>();
        if (request.getProfileId() != null) wrapper.eq("profile_id", request.getProfileId());
        if (request.getJobRowId() != null) {
            wrapper.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("job_id", request.getJobKey());
        } else {
            wrapper.eq("comp_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        wrapper.last("LIMIT 1");
        return liepinMapper.selectOne(wrapper);
    }

    private Job51Entity findJob51ForAnalysis(JobAnalysisRequest request) {
        QueryWrapper<Job51Entity> wrapper = new QueryWrapper<>();
        if (request.getProfileId() != null) wrapper.eq("profile_id", request.getProfileId());
        if (request.getJobRowId() != null) {
            wrapper.eq("id", request.getJobRowId());
        } else if (request.getJobKey() != null && !request.getJobKey().isBlank()) {
            wrapper.eq("job_id", request.getJobKey());
        } else {
            wrapper.eq("comp_name", request.getCompanyName()).eq("job_title", request.getJobName());
        }
        wrapper.last("LIMIT 1");
        return job51Mapper.selectOne(wrapper);
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

    private AiOutputException outputError(String code, String message, String raw) {
        return new AiOutputException(code, message + "（" + responseFingerprint(raw) + "）");
    }

    private String responseDiagnostic(String raw) {
        JSONObject diagnostic = new JSONObject();
        diagnostic.put("kind", "provider_response_fingerprint");
        diagnostic.put("length", raw == null ? 0 : raw.length());
        diagnostic.put("sha256", sha256(raw));
        return diagnostic.toString();
    }

    private String errorDiagnostic(Exception error) {
        JSONObject diagnostic = new JSONObject();
        diagnostic.put("kind", "ai_error");
        diagnostic.put("errorCode", errorCode(error));
        diagnostic.put("message", limit(error == null ? "AI 分析失败" : safe(error.getMessage()), 300));
        if (error instanceof AiProviderException providerError) {
            diagnostic.put("clientRequestId", safe(providerError.getClientRequestId()));
            diagnostic.put("providerRequestId", safe(providerError.getProviderRequestId()));
            diagnostic.put("httpStatus", providerError.getHttpStatus() == null
                    ? JSONObject.NULL
                    : providerError.getHttpStatus());
        }
        return diagnostic.toString();
    }

    private String errorCode(Exception error) {
        if (error instanceof AiOutputException outputError) return outputError.code();
        if (error instanceof AiProviderException providerError) {
            return "AI_PROVIDER_" + providerError.getCode().name();
        }
        return "AI_ANALYSIS_FAILED";
    }

    private String responseFingerprint(String raw) {
        return "length=" + (raw == null ? 0 : raw.length()) + ", sha256=" + sha256(raw);
    }

    private String sha256(String raw) {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest((raw == null ? "" : raw).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (Exception ignored) {
            return "unavailable";
        }
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
        private Long jobRowId;
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

    public record PlatformAnalysisState(boolean completed, boolean failed, String status) {
        public static PlatformAnalysisState incomplete(String status) {
            return new PlatformAnalysisState(false, false, status);
        }
    }

    private static final class AiOutputException extends RuntimeException {
        private final String code;

        private AiOutputException(String code, String message) {
            super(message);
            this.code = code;
        }

        private String code() {
            return code;
        }
    }

    @FunctionalInterface
    public interface LeaseWriteGuard {
        boolean execute(Runnable action);
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
        private boolean staleLease;
        private String errorCode;
        private boolean providerOutcomeUnknown;

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
            map.put("errorCode", errorCode);
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

        public static AnalysisResult staleLease() {
            AnalysisResult result = failed(DeliveryStatus.AI_ANALYSIS_FAILED, "AI 分析任务租约已失效，已丢弃旧执行结果");
            result.setStaleLease(true);
            return result;
        }
    }
}
