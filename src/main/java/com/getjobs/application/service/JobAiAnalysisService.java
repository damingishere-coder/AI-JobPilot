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
import java.util.HexFormat;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
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
    public static final int MAX_BATCH_SIZE = 5;
    private static final String JOB_ANALYSIS_OUTPUT_SCHEMA = """
            {
              "type": "object",
              "properties": {
                "results": {
                  "type": "array",
                  "maxItems": 5,
                  "items": {
                    "type": "object",
                    "properties": {
                      "taskId": {"type": "integer"},
                      "summary": {"type": "string"},
                      "matches": {"type": "array", "items": {"type": "string"}},
                      "gaps": {"type": "array", "items": {"type": "string"}},
                      "unknowns": {"type": "array", "items": {"type": "string"}},
                      "dimensions": {
                        "type": "array",
                        "minItems": 6,
                        "maxItems": 6,
                        "items": {
                          "type": "object",
                          "properties": {
                            "key": {"type": "string", "enum": ["CORE_SKILLS", "RELEVANT_EXPERIENCE", "ACHIEVEMENTS_COMPLEXITY", "INDUSTRY_TRANSFER", "EDUCATION_TENURE", "LOCATION_SALARY"]},
                            "status": {"type": "string", "enum": ["MATCH", "PARTIAL", "UNKNOWN", "CONFLICT"]},
                            "jobEvidence": {"type": "array", "items": {"type": "string"}},
                            "resumeEvidence": {"type": "array", "items": {"type": "string"}},
                            "note": {"type": "string"}
                          },
                          "required": ["key", "status", "jobEvidence", "resumeEvidence", "note"],
                          "additionalProperties": false
                        }
                      },
                      "hardConflicts": {
                        "type": "array",
                        "items": {
                          "type": "object",
                          "properties": {
                            "requirement": {"type": "string"},
                            "jobEvidence": {"type": "array", "items": {"type": "string"}},
                            "resumeEvidence": {"type": "array", "items": {"type": "string"}}
                          },
                          "required": ["requirement", "jobEvidence", "resumeEvidence"],
                          "additionalProperties": false
                        }
                      },
                      "greeting": {"type": "string"}
                    },
                    "required": ["taskId", "summary", "matches", "gaps", "unknowns", "dimensions", "hardConflicts", "greeting"],
                    "additionalProperties": false
                  }
                }
              },
              "required": ["results"],
              "additionalProperties": false
            }
            """;
    private static final List<DimensionSpec> DIMENSION_SPECS = List.of(
            new DimensionSpec("CORE_SKILLS", "核心职责与技能", 35),
            new DimensionSpec("RELEVANT_EXPERIENCE", "相关经历", 25),
            new DimensionSpec("ACHIEVEMENTS_COMPLEXITY", "成果与复杂度", 15),
            new DimensionSpec("INDUSTRY_TRANSFER", "行业可迁移性", 10),
            new DimensionSpec("EDUCATION_TENURE", "学历与年限", 10),
            new DimensionSpec("LOCATION_SALARY", "地点与薪资", 5)
    );
    private static final Map<String, DimensionSpec> DIMENSION_BY_KEY = DIMENSION_SPECS.stream()
            .collect(Collectors.toUnmodifiableMap(DimensionSpec::key, spec -> spec));
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
        String nextResumeText = resumeText == null ? "" : resumeText;
        boolean resumeChanged = current == null || !Objects.equals(current.getResumeText(), nextResumeText);
        if (current == null) {
            current = new ResumeProfileEntity();
            current.setProfileId(profileId);
            current.setCreatedAt(now);
        }
        current.setProfileId(profileId);
        current.setResumeText(nextResumeText);
        current.setSourceFilename(sourceFilename);
        current.setParseStatus(status == null ? "manual" : status);
        current.setParseMessage(message);
        if (resumeChanged) current.setRecommendedJobKeywords(null);
        current.setUpdatedAt(now);
        if (current.getId() == null) {
            resumeProfileMapper.insert(current);
        } else {
            resumeProfileMapper.updateById(current);
        }
        return current;
    }

    @Transactional
    public List<String> saveRecommendedJobKeywords(List<String> keywords) {
        List<String> normalized = JobKeywordCodec.normalize(keywords, JobKeywordCodec.MAX_SELECTED);
        if (normalized.isEmpty()) {
            throw new IllegalArgumentException("AI未生成有效的岗位关键词");
        }
        ResumeProfileEntity current = getResumeProfile();
        if (current == null || current.getId() == null) {
            throw new IllegalArgumentException("请先保存当前档案的简历内容");
        }
        ResumeProfileEntity update = new ResumeProfileEntity();
        update.setId(current.getId());
        update.setRecommendedJobKeywords(JobKeywordCodec.serialize(normalized));
        update.setUpdatedAt(LocalDateTime.now());
        resumeProfileMapper.updateById(update);
        return normalized;
    }

    public List<String> getRecommendedJobKeywords() {
        ResumeProfileEntity current = getResumeProfile();
        return current == null ? List.of() : JobKeywordCodec.parse(current.getRecommendedJobKeywords());
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
        BatchAnalysisJob job = new BatchAnalysisJob(1L, request, leaseIsCurrent, leaseWriteGuard);
        return analyzeJobs(List.of(job)).getOrDefault(1L,
                AnalysisResult.failed(DeliveryStatus.AI_ANALYSIS_FAILED, "AI 分析未返回结果"));
    }

    /**
     * 同一档案、同一平台的岗位批量分析。模型只判断维度与证据，分数和决策始终由后端计算。
     */
    public Map<Long, AnalysisResult> analyzeJobs(List<BatchAnalysisJob> jobs) {
        validateBatch(jobs);
        Map<Long, AnalysisResult> completed = new LinkedHashMap<>();
        List<PreparedJob> prepared = new ArrayList<>();

        for (BatchAnalysisJob job : jobs) {
            JobAnalysisRequest request = job.request();
            if (!isLeaseCurrent(job.leaseIsCurrent())) {
                completed.put(job.taskId(), AnalysisResult.staleLease());
                continue;
            }
            Long profileId = resolveAnalysisProfileId(request);
            request.setProfileId(profileId);
            AtomicBoolean platformReserved = new AtomicBoolean();
            if (!executeLeaseWrite(job.leaseWriteGuard(),
                    () -> platformReserved.set(markPlatformAnalysisStarted(request)))) {
                completed.put(job.taskId(), AnalysisResult.staleLease());
                continue;
            }
            if (!platformReserved.get()) {
                completed.put(job.taskId(), AnalysisResult.failed(
                        DeliveryStatus.AI_ANALYSIS_FAILED,
                        "岗位状态已变化或岗位不存在，未调用 AI Provider"));
                continue;
            }
            boolean priority = isPriorityCompany(request.getCompanyName(), profileId);
            prepared.add(new PreparedJob(
                    job,
                    priority,
                    resolveApplyThreshold(profileId, priority)
            ));
        }

        if (prepared.isEmpty()) return completed;
        Long profileId = prepared.get(0).job().request().getProfileId();
        ResumeProfileEntity resume = getResumeProfile(profileId);
        String resumeText = resume == null ? "" : resume.getResumeText();
        if (resumeText == null || resumeText.trim().isEmpty()) {
            for (PreparedJob job : prepared) {
                AnalysisResult failure = AnalysisResult.failed(
                        DeliveryStatus.AI_ANALYSIS_FAILED, "请先在AI配置页保存简历内容");
                failure.setErrorCode("AI_RESUME_MISSING");
                completed.put(job.job().taskId(), finalizeResult(
                        job, failure, "{\"errorCode\":\"AI_RESUME_MISSING\"}", false));
            }
            return completed;
        }

        String prompt = buildBatchPrompt(resumeText, prepared);
        String raw = null;
        try {
            raw = aiService.sendStructuredRequest(prompt, JOB_ANALYSIS_OUTPUT_SCHEMA);
            BatchParse parsed;
            try {
                parsed = parseBatchResults(raw, prepared.stream()
                        .map(job -> job.job().taskId()).toList());
            } catch (AiOutputException outputError) {
                if (!isWholeBatchFormatError(outputError)) throw outputError;
                if (prepared.stream().noneMatch(job -> isLeaseCurrent(job.job().leaseIsCurrent()))) {
                    prepared.forEach(job -> completed.putIfAbsent(
                            job.job().taskId(), AnalysisResult.staleLease()));
                    return completed;
                }
                log.warn("AI岗位批量分析返回无效 JSON，将使用同一 Provider、模型和 Schema 重试一次: {}",
                        outputError.getMessage());
                raw = aiService.sendStructuredRequest(
                        prompt + "\n\n重要：上一次输出不是有效的批量 JSON。本次只返回一个完全符合 Schema 的 JSON 对象，不要输出 Markdown、解释或额外文本。",
                        JOB_ANALYSIS_OUTPUT_SCHEMA
                );
                parsed = parseBatchResults(raw, prepared.stream()
                        .map(job -> job.job().taskId()).toList());
            }

            Map<Long, PreparedJob> byTaskId = prepared.stream().collect(Collectors.toMap(
                    job -> job.job().taskId(), job -> job, (left, right) -> left, LinkedHashMap::new));
            for (Map.Entry<Long, AnalysisResult> entry : parsed.results().entrySet()) {
                PreparedJob job = byTaskId.get(entry.getKey());
                if (job != null) {
                    verifyQuotedEvidence(entry.getValue(), job.job().request(), resumeText);
                    completed.put(entry.getKey(), finalizeResult(
                            job, entry.getValue(), responseDiagnostic(raw), true));
                }
            }
            for (Map.Entry<Long, AiOutputException> entry : parsed.errors().entrySet()) {
                PreparedJob job = byTaskId.get(entry.getKey());
                if (job == null || completed.containsKey(entry.getKey())) continue;
                completed.put(entry.getKey(), retrySingleInvalidJob(
                        resumeText, job, entry.getValue()));
            }
            return completed;
        } catch (Exception e) {
            log.warn("AI岗位批量分析失败: {}", e.getMessage());
            for (PreparedJob job : prepared) {
                if (completed.containsKey(job.job().taskId())) continue;
                completed.put(job.job().taskId(), finalizeFailure(job, e, true));
            }
            return completed;
        }
    }

    private AnalysisResult retrySingleInvalidJob(String resumeText,
                                                 PreparedJob job,
                                                 AiOutputException initialError) {
        if (!isLeaseCurrent(job.job().leaseIsCurrent())) return AnalysisResult.staleLease();
        try {
            log.warn("AI岗位批量结果中的任务 {} 缺失或无效，将只重试该岗位一次: {}",
                    job.job().taskId(), initialError.getMessage());
            String retryPrompt = buildBatchPrompt(resumeText, List.of(job))
                    + "\n\n重要：上一次批量结果中这个岗位缺失或字段无效。本次只返回这个 taskId 的完整结果。";
            String retryRaw = aiService.sendStructuredRequest(retryPrompt, JOB_ANALYSIS_OUTPUT_SCHEMA);
            BatchParse retried = parseBatchResults(retryRaw, List.of(job.job().taskId()));
            AnalysisResult result = retried.results().get(job.job().taskId());
            if (result == null) {
                throw retried.errors().getOrDefault(job.job().taskId(), initialError);
            }
            verifyQuotedEvidence(result, job.job().request(), resumeText);
            return finalizeResult(job, result, responseDiagnostic(retryRaw), true);
        } catch (Exception e) {
            return finalizeFailure(job, e, true);
        }
    }

    private AnalysisResult finalizeFailure(PreparedJob job, Exception error, boolean providerWasCalled) {
        if (!isLeaseCurrent(job.job().leaseIsCurrent())) return AnalysisResult.staleLease();
        AnalysisResult result = AnalysisResult.failed(
                DeliveryStatus.AI_ANALYSIS_FAILED,
                error == null ? "AI 分析失败" : error.getMessage());
        result.setErrorCode(errorCode(error));
        result.setProviderOutcomeUnknown(
                error instanceof AiProviderException providerError && providerError.isOutcomeUnknown());
        return finalizeResult(job, result, errorDiagnostic(error), providerWasCalled);
    }

    private AnalysisResult finalizeResult(PreparedJob job,
                                          AnalysisResult result,
                                          String diagnostic,
                                          boolean providerWasCalled) {
        result.setPriorityCompany(job.priority());
        result.setThreshold(job.threshold());
        if (!result.isFailure() && !result.isStaleLease()) {
            boolean hasHardConflict = result.getHardConflicts() != null
                    && !result.getHardConflicts().isEmpty();
            result.setDecision(!hasHardConflict && result.getScore() != null
                    && result.getScore() >= job.threshold() ? "APPLY" : "SKIP");
        }
        if (!isLeaseCurrent(job.job().leaseIsCurrent())) return AnalysisResult.staleLease();
        AtomicReference<AnalysisResult> storedResult = new AtomicReference<>(result);
        if (!executeLeaseWrite(job.job().leaseWriteGuard(), () -> storedResult.set(persistAndUpdate(
                job.job().request(), result, diagnostic, providerWasCalled)))) {
            return AnalysisResult.staleLease();
        }
        return storedResult.get();
    }

    private boolean isWholeBatchFormatError(AiOutputException error) {
        return error != null && Set.of(
                "AI_OUTPUT_EMPTY", "AI_OUTPUT_INVALID_JSON", "AI_OUTPUT_INVALID_BATCH"
        ).contains(error.code());
    }

    private void validateBatch(List<BatchAnalysisJob> jobs) {
        if (jobs == null || jobs.isEmpty()) throw new IllegalArgumentException("岗位分析批次不能为空");
        if (jobs.size() > MAX_BATCH_SIZE) throw new IllegalArgumentException("岗位分析批次最多包含5个岗位");
        Set<Long> taskIds = new HashSet<>();
        Long profileId = null;
        String platform = null;
        for (BatchAnalysisJob job : jobs) {
            if (job == null || job.request() == null) throw new IllegalArgumentException("岗位分析请求不能为空");
            if (job.taskId() <= 0 || !taskIds.add(job.taskId())) {
                throw new IllegalArgumentException("岗位分析批次包含无效或重复的 taskId");
            }
            Long resolvedProfileId = resolveAnalysisProfileId(job.request());
            String normalizedPlatform = safe(job.request().getPlatform()).trim().toLowerCase(Locale.ROOT);
            if (profileId == null) profileId = resolvedProfileId;
            if (platform == null) platform = normalizedPlatform;
            if (!Objects.equals(profileId, resolvedProfileId) || !Objects.equals(platform, normalizedPlatform)) {
                throw new IllegalArgumentException("岗位分析批次只能包含同一档案和同一平台的任务");
            }
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
        int max = Math.max(1, Math.min(limitCount <= 0 ? 5 : limitCount, JobKeywordCodec.MAX_SELECTED));
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

    private String buildBatchPrompt(String resumeText, List<PreparedJob> jobs) {
        JSONArray jobArray = new JSONArray();
        for (PreparedJob prepared : jobs) {
            JobAnalysisRequest request = prepared.job().request();
            JSONObject job = new JSONObject();
            job.put("taskId", prepared.job().taskId());
            job.put("platform", safe(request.getPlatform()));
            job.put("keyword", safe(request.getKeyword()));
            job.put("companyName", safe(request.getCompanyName()));
            job.put("jobName", safe(request.getJobName()));
            job.put("salary", safe(request.getSalary()));
            job.put("location", safe(request.getLocation()));
            job.put("experience", safe(request.getExperience()));
            job.put("degree", safe(request.getDegree()));
            job.put("companyInfo", limit(safe(request.getCompanyInfo()), 2000));
            job.put("jobDescription", limit(safe(request.getJobDescription()), 5000));
            jobArray.put(job);
        }
        return "你是求职岗位证据分析助手。请比较一份候选人简历和多个岗位，但不要计算分数，也不要给出 APPLY/SKIP 决策。\n" +
                "只返回符合 Schema 的 JSON，不要使用 Markdown 或额外解释。每个输入 taskId 必须且只能返回一次。\n" +
                "六个维度必须各返回一次：CORE_SKILLS、RELEVANT_EXPERIENCE、ACHIEVEMENTS_COMPLEXITY、INDUSTRY_TRANSFER、EDUCATION_TENURE、LOCATION_SALARY。\n" +
                "每个维度的 status 只能是 MATCH、PARTIAL、UNKNOWN、CONFLICT。\n" +
                "采用宁可多投原则：简历没有写明的信息只能判 UNKNOWN，不能推断为不具备；只有岗位明确要求且简历明确冲突时才能判 CONFLICT。\n" +
                "jobEvidence 和 resumeEvidence 必须摘录对应原文短句。硬冲突必须同时具有岗位原文和简历原文，并复用对应 CONFLICT 分项中的双方证据；证据不足的差异放入 unknowns，不得放入 hardConflicts。\n" +
                "summary 用一句自然中文给出总体结论，不要提分数、阈值或投递决策；matches 写具体匹配证据，gaps 只写有明确证据的差距，unknowns 写待核实信息。\n" +
                "greeting 生成一条基于真实匹配点、不过度承诺的简短招呼语。\n\n" +
                "候选人简历（本批岗位共用，只出现一次）：\n" + limit(resumeText, 6000) + "\n\n" +
                "待分析岗位 JSON：\n" + jobArray;
    }

    private BatchParse parseBatchResults(String raw, List<Long> expectedTaskIds) {
        JSONObject root = new JSONObject(repairJsonObject(extractJson(raw)));
        if (!(root.opt("results") instanceof JSONArray values)) {
            throw outputError("AI_OUTPUT_INVALID_BATCH", "AI 返回缺少 results 数组", raw);
        }
        Set<Long> expected = new HashSet<>(expectedTaskIds);
        Set<Long> seen = new HashSet<>();
        Map<Long, AnalysisResult> results = new LinkedHashMap<>();
        Map<Long, AiOutputException> errors = new LinkedHashMap<>();
        for (int i = 0; i < values.length(); i++) {
            Object value = values.opt(i);
            if (!(value instanceof JSONObject item)) continue;
            Object taskIdValue = item.opt("taskId");
            if (!(taskIdValue instanceof Number number)
                    || number.doubleValue() != Math.rint(number.doubleValue())) continue;
            long taskId = number.longValue();
            if (!expected.contains(taskId)) continue;
            if (!seen.add(taskId)) {
                errors.put(taskId, outputError(
                        "AI_OUTPUT_INVALID_SCHEMA", "AI 返回重复 taskId: " + taskId, raw));
                results.remove(taskId);
                continue;
            }
            try {
                results.put(taskId, parseEvidenceResult(item, raw));
            } catch (AiOutputException e) {
                errors.put(taskId, e);
            }
        }
        for (Long taskId : expectedTaskIds) {
            if (!results.containsKey(taskId) && !errors.containsKey(taskId)) {
                errors.put(taskId, outputError(
                        "AI_OUTPUT_MISSING_ITEM", "AI 返回缺少 taskId: " + taskId, raw));
            }
        }
        return new BatchParse(results, errors);
    }

    private AnalysisResult parseEvidenceResult(JSONObject item, String raw) {
        for (String field : List.of(
                "summary", "matches", "gaps", "unknowns", "dimensions", "hardConflicts", "greeting")) {
            if (!item.has(field) || item.isNull(field)) {
                throw outputError("AI_OUTPUT_MISSING_FIELD", "AI 返回缺少字段: " + field, raw);
            }
        }
        if (!(item.opt("summary") instanceof String summary) || summary.isBlank()) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回 summary 不能为空", raw);
        }
        if (!(item.opt("matches") instanceof JSONArray matches)
                || !(item.opt("gaps") instanceof JSONArray gaps)
                || !(item.opt("unknowns") instanceof JSONArray unknowns)
                || !(item.opt("dimensions") instanceof JSONArray dimensions)
                || !(item.opt("hardConflicts") instanceof JSONArray hardConflicts)
                || !(item.opt("greeting") instanceof String greeting)
                || !containsOnlyStrings(matches)
                || !containsOnlyStrings(gaps)
                || !containsOnlyStrings(unknowns)) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回字段类型不符合约定", raw);
        }

        List<String> unknownItems = new ArrayList<>(toStringList(unknowns));
        List<DimensionScore> dimensionScores = parseDimensions(dimensions, unknownItems, raw);
        List<HardConflict> validHardConflicts = parseHardConflicts(hardConflicts, unknownItems, raw);
        int score = (int) Math.round(dimensionScores.stream()
                .mapToDouble(value -> value.getWeight() * MatchStatus.valueOf(value.getStatus()).factor)
                .sum());

        AnalysisResult result = new AnalysisResult();
        result.setScore(score);
        result.setDecision("SKIP");
        result.setSummary(summary.trim());
        result.setMatches(toStringList(matches));
        result.setGaps(toStringList(gaps));
        result.setUnknowns(List.copyOf(unknownItems));
        result.setDimensions(dimensionScores);
        result.setHardConflicts(validHardConflicts);
        result.setStrengths(result.getMatches());
        result.setRisks(result.getGaps());
        result.setGreeting(greeting.trim());
        return result;
    }

    private List<DimensionScore> parseDimensions(JSONArray dimensions,
                                                 List<String> unknowns,
                                                 String raw) {
        if (dimensions.length() != DIMENSION_SPECS.size()) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回必须包含六个评分维度", raw);
        }
        Map<String, DimensionScore> parsed = new LinkedHashMap<>();
        for (int i = 0; i < dimensions.length(); i++) {
            Object value = dimensions.opt(i);
            if (!(value instanceof JSONObject dimension)) {
                throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回维度必须是对象", raw);
            }
            String key = dimension.optString("key", "").trim().toUpperCase(Locale.ROOT);
            String statusText = dimension.optString("status", "").trim().toUpperCase(Locale.ROOT);
            DimensionSpec spec = DIMENSION_BY_KEY.get(key);
            MatchStatus status;
            try {
                status = MatchStatus.valueOf(statusText);
            } catch (IllegalArgumentException e) {
                throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回未知维度状态: " + statusText, raw);
            }
            if (spec == null || parsed.containsKey(key)
                    || !(dimension.opt("jobEvidence") instanceof JSONArray jobEvidence)
                    || !(dimension.opt("resumeEvidence") instanceof JSONArray resumeEvidence)
                    || !(dimension.opt("note") instanceof String note)
                    || !containsOnlyStrings(jobEvidence)
                    || !containsOnlyStrings(resumeEvidence)) {
                throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回维度字段无效或重复", raw);
            }
            List<String> jobEvidenceItems = toStringList(jobEvidence);
            List<String> resumeEvidenceItems = toStringList(resumeEvidence);
            if (status == MatchStatus.CONFLICT
                    && (jobEvidenceItems.isEmpty() || resumeEvidenceItems.isEmpty())) {
                status = MatchStatus.UNKNOWN;
                unknowns.add(spec.label() + "存在差异描述，但缺少双方原文证据，已降级为待核实");
            }
            DimensionScore score = new DimensionScore();
            score.setKey(spec.key());
            score.setLabel(spec.label());
            score.setWeight(spec.weight());
            score.setStatus(status.name());
            score.setAwarded(spec.weight() * status.factor);
            score.setJobEvidence(jobEvidenceItems);
            score.setResumeEvidence(resumeEvidenceItems);
            score.setNote(note.trim());
            parsed.put(key, score);
        }
        if (!parsed.keySet().equals(DIMENSION_BY_KEY.keySet())) {
            throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回评分维度不完整", raw);
        }
        return DIMENSION_SPECS.stream().map(spec -> parsed.get(spec.key())).toList();
    }

    private List<HardConflict> parseHardConflicts(JSONArray conflicts,
                                                  List<String> unknowns,
                                                  String raw) {
        List<HardConflict> valid = new ArrayList<>();
        for (int i = 0; i < conflicts.length(); i++) {
            Object value = conflicts.opt(i);
            if (!(value instanceof JSONObject conflict)
                    || !(conflict.opt("requirement") instanceof String requirement)
                    || !(conflict.opt("jobEvidence") instanceof JSONArray jobEvidence)
                    || !(conflict.opt("resumeEvidence") instanceof JSONArray resumeEvidence)
                    || !containsOnlyStrings(jobEvidence)
                    || !containsOnlyStrings(resumeEvidence)) {
                throw outputError("AI_OUTPUT_INVALID_SCHEMA", "AI 返回硬冲突字段无效", raw);
            }
            List<String> jobEvidenceItems = toStringList(jobEvidence);
            List<String> resumeEvidenceItems = toStringList(resumeEvidence);
            if (requirement.isBlank() || jobEvidenceItems.isEmpty() || resumeEvidenceItems.isEmpty()) {
                String label = requirement.isBlank() ? "疑似硬性要求" : requirement.trim();
                unknowns.add(label + "缺少双方原文证据，已降级为待核实");
                continue;
            }
            HardConflict hardConflict = new HardConflict();
            hardConflict.setRequirement(requirement.trim());
            hardConflict.setJobEvidence(jobEvidenceItems);
            hardConflict.setResumeEvidence(resumeEvidenceItems);
            valid.add(hardConflict);
        }
        return List.copyOf(valid);
    }

    private void verifyQuotedEvidence(AnalysisResult result,
                                      JobAnalysisRequest request,
                                      String resumeText) {
        if (result == null) return;
        String jobSource = String.join("\n",
                safe(request.getKeyword()),
                safe(request.getCompanyName()),
                safe(request.getJobName()),
                safe(request.getSalary()),
                safe(request.getLocation()),
                safe(request.getExperience()),
                safe(request.getDegree()),
                safe(request.getCompanyInfo()),
                safe(request.getJobDescription()));
        List<String> unknowns = new ArrayList<>(result.getUnknowns() == null
                ? List.of() : result.getUnknowns());
        for (DimensionScore dimension : result.getDimensions() == null
                ? List.<DimensionScore>of() : result.getDimensions()) {
            MatchStatus status = MatchStatus.valueOf(dimension.getStatus());
            if (status == MatchStatus.UNKNOWN) continue;
            if (quotesExist(dimension.getJobEvidence(), jobSource)
                    && quotesExist(dimension.getResumeEvidence(), resumeText)) continue;
            dimension.setStatus(MatchStatus.UNKNOWN.name());
            dimension.setAwarded(dimension.getWeight() * MatchStatus.UNKNOWN.factor);
            unknowns.add(dimension.getLabel() + "的双方原文证据无法核验，已降级为待核实");
        }

        List<DimensionScore> conflictDimensions = (result.getDimensions() == null
                ? List.<DimensionScore>of() : result.getDimensions()).stream()
                .filter(dimension -> MatchStatus.CONFLICT.name().equals(dimension.getStatus()))
                .toList();
        List<HardConflict> verifiedHardConflicts = new ArrayList<>();
        for (HardConflict conflict : result.getHardConflicts() == null
                ? List.<HardConflict>of() : result.getHardConflicts()) {
            if (quotesExist(conflict.getJobEvidence(), jobSource)
                    && quotesExist(conflict.getResumeEvidence(), resumeText)
                    && conflictDimensions.stream().anyMatch(dimension ->
                    sharesEvidence(conflict.getJobEvidence(), dimension.getJobEvidence())
                            && sharesEvidence(conflict.getResumeEvidence(), dimension.getResumeEvidence()))) {
                verifiedHardConflicts.add(conflict);
            } else {
                unknowns.add(conflict.getRequirement() + "的原文证据无法核验或与冲突分项不一致，已降级为待核实");
            }
        }

        int verifiedScore = (int) Math.round((result.getDimensions() == null
                ? List.<DimensionScore>of() : result.getDimensions()).stream()
                .mapToDouble(value -> value.getAwarded() == null ? 0.0 : value.getAwarded())
                .sum());
        result.setScore(verifiedScore);
        result.setUnknowns(List.copyOf(unknowns));
        result.setHardConflicts(List.copyOf(verifiedHardConflicts));
    }

    private boolean quotesExist(List<String> quotes, String source) {
        if (quotes == null || quotes.isEmpty()) return false;
        String normalizedSource = normalizeEvidence(source);
        return quotes.stream()
                .map(this::normalizeEvidence)
                .allMatch(quote -> !quote.isBlank() && normalizedSource.contains(quote));
    }

    private boolean sharesEvidence(List<String> left, List<String> right) {
        if (left == null || right == null) return false;
        Set<String> normalizedRight = right.stream()
                .map(this::normalizeEvidence)
                .filter(value -> !value.isBlank())
                .collect(Collectors.toSet());
        return left.stream().map(this::normalizeEvidence)
                .anyMatch(value -> !value.isBlank() && normalizedRight.contains(value));
    }

    private String normalizeEvidence(String value) {
        return safe(value).replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
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
        String original = raw.trim();
        try {
            new JSONObject(original);
            return original;
        } catch (Exception ignored) {
        }

        String s = original
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
        for (String key : List.of(
                "results", "taskId", "summary", "matches", "gaps", "unknowns", "dimensions",
                "hardConflicts", "greeting", "key", "status", "jobEvidence", "resumeEvidence",
                "note", "requirement")) {
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

    public record BatchAnalysisJob(long taskId,
                                   JobAnalysisRequest request,
                                   BooleanSupplier leaseIsCurrent,
                                   LeaseWriteGuard leaseWriteGuard) {
    }

    private record PreparedJob(BatchAnalysisJob job, boolean priority, int threshold) {
    }

    private record BatchParse(Map<Long, AnalysisResult> results,
                              Map<Long, AiOutputException> errors) {
    }

    private record DimensionSpec(String key, String label, int weight) {
    }

    private enum MatchStatus {
        MATCH(1.0),
        PARTIAL(0.75),
        UNKNOWN(0.6),
        CONFLICT(0.0);

        private final double factor;

        MatchStatus(double factor) {
            this.factor = factor;
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
        private Integer schemaVersion = 2;
        private Integer score;
        private String decision;
        private String summary;
        private List<String> strengths = new ArrayList<>();
        private List<String> risks = new ArrayList<>();
        private List<String> matches = new ArrayList<>();
        private List<String> gaps = new ArrayList<>();
        private List<String> unknowns = new ArrayList<>();
        private List<DimensionScore> dimensions = new ArrayList<>();
        private List<HardConflict> hardConflicts = new ArrayList<>();
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
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("schemaVersion", schemaVersion);
            map.put("summary", summary);
            map.put("matches", matches == null || matches.isEmpty() ? strengths : matches);
            map.put("gaps", gaps == null || gaps.isEmpty() ? risks : gaps);
            map.put("unknowns", unknowns);
            map.put("dimensions", dimensions == null ? List.of() : dimensions.stream()
                    .map(DimensionScore::toMap).toList());
            map.put("hardConflicts", hardConflicts == null ? List.of() : hardConflicts.stream()
                    .map(HardConflict::toMap).toList());
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

    @Data
    public static class DimensionScore {
        private String key;
        private String label;
        private Integer weight;
        private String status;
        private Double awarded;
        private List<String> jobEvidence = new ArrayList<>();
        private List<String> resumeEvidence = new ArrayList<>();
        private String note;

        private Map<String, Object> toMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("key", key);
            map.put("label", label);
            map.put("weight", weight);
            map.put("status", status);
            map.put("awarded", awarded);
            map.put("jobEvidence", jobEvidence);
            map.put("resumeEvidence", resumeEvidence);
            map.put("note", note);
            return map;
        }
    }

    @Data
    public static class HardConflict {
        private String requirement;
        private List<String> jobEvidence = new ArrayList<>();
        private List<String> resumeEvidence = new ArrayList<>();

        private Map<String, Object> toMap() {
            Map<String, Object> map = new LinkedHashMap<>();
            map.put("requirement", requirement);
            map.put("jobEvidence", jobEvidence);
            map.put("resumeEvidence", resumeEvidence);
            return map;
        }
    }
}
