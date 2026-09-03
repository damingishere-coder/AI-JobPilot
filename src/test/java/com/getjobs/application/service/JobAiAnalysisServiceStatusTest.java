package com.getjobs.application.service;

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
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.json.JSONArray;
import org.json.JSONObject;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class JobAiAnalysisServiceStatusTest {
    private static final Long PROFILE_ID = 1L;

    @Mock
    private AiService aiService;
    @Mock
    private ProfileService profileService;
    @Mock
    private ResumeProfileMapper resumeProfileMapper;
    @Mock
    private PriorityCompanyMapper priorityCompanyMapper;
    @Mock
    private JobAiAnalysisMapper jobAiAnalysisMapper;
    @Mock
    private BossJobDataMapper bossJobDataMapper;
    @Mock
    private ZhilianJobDataMapper zhilianJobDataMapper;
    @Mock
    private LiepinMapper liepinMapper;
    @Mock
    private Job51Mapper job51Mapper;

    private JobAiAnalysisService service;

    @BeforeEach
    void setUp() {
        service = new JobAiAnalysisService(
                aiService,
                profileService,
                resumeProfileMapper,
                priorityCompanyMapper,
                jobAiAnalysisMapper,
                bossJobDataMapper,
                zhilianJobDataMapper,
                liepinMapper,
                job51Mapper
        );
        lenient().when(priorityCompanyMapper.selectList(any())).thenReturn(List.of());
        lenient().when(jobAiAnalysisMapper.insert(
                any(com.getjobs.application.entity.JobAiAnalysisEntity.class))).thenReturn(1);
        lenient().when(bossJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1);
        lenient().when(zhilianJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1);
        lenient().when(liepinMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1);
        lenient().when(job51Mapper.update(any(), any(UpdateWrapper.class))).thenReturn(1);
    }

    @Test
    void bossApplyUpdatesWaitingConfirm() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));

        service.updatePlatformCache(bossRequest(), analysis("APPLY"));

        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void bossSkipUpdatesAiNotMatch() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));

        service.updatePlatformCache(bossRequest(), analysis("SKIP"));

        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_NOT_MATCH);
    }

    @Test
    void reasonTextUsesVersionTwoWithoutDatabaseMigration() {
        JobAiAnalysisService.AnalysisResult result = analysis("APPLY");
        result.setMatches(List.of("岗位和简历均包含 Java"));
        result.setUnknowns(List.of("到岗时间待核实"));
        result.setThreshold(75);

        JSONObject reason = new JSONObject(result.toReasonText());

        assertThat(reason.getInt("schemaVersion")).isEqualTo(2);
        assertThat(reason.getJSONArray("matches").getString(0)).contains("Java");
        assertThat(reason.getJSONArray("unknowns").getString(0)).contains("待核实");
    }

    @Test
    void savingThresholdsPromotesOnlyCurrentProfileBossAiNotMatchRowsThatMeetStoredPriorityRules() {
        AiEntity saved = new AiEntity();
        saved.setProfileId(PROFILE_ID);
        saved.setApplyThreshold(60);
        saved.setPriorityApplyThreshold(50);
        when(aiService.saveOrUpdateAiThresholds(60, 50)).thenReturn(saved);
        when(bossJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(4);

        JobAiAnalysisService.ThresholdApplicationResult result =
                service.saveThresholdsAndPromoteBossHistory(60, 50);

        assertThat(result.thresholds()).isSameAs(saved);
        assertThat(result.bossHistoricalPromotedCount()).isEqualTo(4);

        ArgumentCaptor<BossJobDataEntity> updateCaptor = ArgumentCaptor.forClass(BossJobDataEntity.class);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<UpdateWrapper<BossJobDataEntity>> wrapperCaptor =
                ArgumentCaptor.forClass(UpdateWrapper.class);
        verify(bossJobDataMapper).update(updateCaptor.capture(), wrapperCaptor.capture());

        assertThat(updateCaptor.getValue().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
        assertThat(updateCaptor.getValue().getAiDecision()).isEqualTo("APPLY");
        assertThat(updateCaptor.getValue().getAiScore()).isNull();
        assertThat(updateCaptor.getValue().getAiReason()).isNull();
        assertThat(updateCaptor.getValue().getUpdatedAt()).isNotNull();

        UpdateWrapper<BossJobDataEntity> wrapper = wrapperCaptor.getValue();
        assertThat(wrapper.getSqlSegment())
                .contains("profile_id", "delivery_status", "ai_score", "priority_company")
                .contains("IS NOT NULL", "OR");
        assertThat(wrapper.getParamNameValuePairs().values())
                .contains(PROFILE_ID, DeliveryStatus.AI_NOT_MATCH, 1, 50, 60);
        verify(aiService, never()).sendStructuredRequest(any(), any());
    }

    @Test
    void thresholdValidationFailureDoesNotAttemptHistoricalBossUpdate() {
        when(aiService.saveOrUpdateAiThresholds(60, 70))
                .thenThrow(new IllegalArgumentException("优先公司分数线不能高于普通公司分数线"));

        assertThatThrownBy(() -> service.saveThresholdsAndPromoteBossHistory(60, 70))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("优先公司分数线");

        verify(bossJobDataMapper, never()).update(any(), any(UpdateWrapper.class));
    }

    @Test
    void zhilianApplyUpdatesWaitingConfirm() {
        when(zhilianJobDataMapper.selectOne(any())).thenReturn(zhilianJob(DeliveryStatus.NOT_DELIVERED));

        service.updatePlatformCache(zhilianRequest(), analysis("APPLY"));

        assertThat(lastZhilianUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void zhilianSkipUpdatesAiNotMatch() {
        when(zhilianJobDataMapper.selectOne(any())).thenReturn(zhilianJob(DeliveryStatus.NOT_DELIVERED));

        service.updatePlatformCache(zhilianRequest(), analysis("SKIP"));

        assertThat(lastZhilianUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_NOT_MATCH);
    }

    @Test
    void liepinApplyUpdatesWaitingConfirm() {
        LiepinEntity current = new LiepinEntity();
        current.setId(21L);
        current.setProfileId(PROFILE_ID);
        current.setJobId(2100L);
        current.setDeliveryStatus(DeliveryStatus.NOT_DELIVERED);
        when(liepinMapper.selectOne(any())).thenReturn(current);

        service.updatePlatformCache(legacyRequest("liepin", 21L, "2100"), analysis("APPLY"));

        ArgumentCaptor<LiepinEntity> captor = ArgumentCaptor.forClass(LiepinEntity.class);
        verify(liepinMapper).update(captor.capture(), any(UpdateWrapper.class));
        assertThat(captor.getValue().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
        assertThat(captor.getValue().getAiScore()).isEqualTo(90);
    }

    @Test
    void job51SkipUpdatesAiNotMatch() {
        Job51Entity current = new Job51Entity();
        current.setId(31L);
        current.setProfileId(PROFILE_ID);
        current.setJobId(3100L);
        current.setDeliveryStatus(DeliveryStatus.NOT_DELIVERED);
        when(job51Mapper.selectOne(any())).thenReturn(current);

        service.updatePlatformCache(legacyRequest("51job", 31L, "3100"), analysis("SKIP"));

        ArgumentCaptor<Job51Entity> captor = ArgumentCaptor.forClass(Job51Entity.class);
        verify(job51Mapper).update(captor.capture(), any(UpdateWrapper.class));
        assertThat(captor.getValue().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_NOT_MATCH);
        assertThat(captor.getValue().getAiScore()).isEqualTo(20);
    }

    @Test
    void deliveredJobKeepsStatusWhenAnalyzedAgain() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.DELIVERED));

        service.updatePlatformCache(bossRequest(), analysis("SKIP"));

        assertThat(lastBossUpdate().getDeliveryStatus()).isNull();
    }

    @Test
    void restartInspectionRecognizesPersistedPlatformResult() {
        BossJobDataEntity completed = bossJob(DeliveryStatus.WAITING_CONFIRM);
        completed.setAiDecision("APPLY");
        when(bossJobDataMapper.selectOne(any())).thenReturn(completed);

        JobAiAnalysisService.PlatformAnalysisState state = service.inspectPlatformAnalysis(bossRequest());

        assertThat(state.completed()).isTrue();
        assertThat(state.failed()).isFalse();
        assertThat(state.status()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void restartInspectionIgnoresStaleDecisionWhileTaskIsStillAnalyzing() {
        BossJobDataEntity analyzing = bossJob(DeliveryStatus.AI_ANALYZING);
        analyzing.setAiDecision(DeliveryStatus.AI_ANALYSIS_FAILED);
        when(bossJobDataMapper.selectOne(any())).thenReturn(analyzing);

        JobAiAnalysisService.PlatformAnalysisState state = service.inspectPlatformAnalysis(bossRequest());

        assertThat(state.completed()).isFalse();
        assertThat(state.failed()).isFalse();
    }

    @Test
    void restartInspectionDoesNotTreatOldDecisionAsCompletedWithoutResultStatus() {
        BossJobDataEntity pending = bossJob(DeliveryStatus.NOT_DELIVERED);
        pending.setAiDecision(DeliveryStatus.AI_ANALYSIS_FAILED);
        when(bossJobDataMapper.selectOne(any())).thenReturn(pending);

        JobAiAnalysisService.PlatformAnalysisState state = service.inspectPlatformAnalysis(bossRequest());

        assertThat(state.completed()).isFalse();
        assertThat(state.failed()).isFalse();
    }

    @Test
    void interruptedRecoveryOnlyWritesExplicitAiFailure() {
        when(zhilianJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1);

        boolean changed = service.markAnalysisInterrupted(zhilianRequest(), "租约过期，结果未知");

        assertThat(changed).isTrue();
        ZhilianJobDataEntity update = lastZhilianUpdate();
        assertThat(update.getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_ANALYSIS_FAILED);
        assertThat(update.getAiDecision()).isEqualTo(DeliveryStatus.AI_ANALYSIS_FAILED);
        assertThat(update.getAiReason()).contains("结果未知");
    }

    @Test
    void durableTaskDoesNotCallProviderWhenExactJobCannotBeReserved() {
        JobAiAnalysisService.JobAnalysisRequest request = bossRequest();
        request.setJobRowId(99L);
        when(bossJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(0);

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(request);

        assertThat(result.isFailure()).isTrue();
        assertThat(result.getSummary()).contains("未调用 AI Provider");
        verify(aiService, never()).sendStructuredRequest(any(), any());
    }

    @Test
    void leaseTransactionRejectsLateProviderResultBeforeAnyResultWrite() {
        JobAiAnalysisService.JobAnalysisRequest request = bossRequest();
        request.setJobRowId(99L);
        when(bossJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1);
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult("旧租约结果"));
        AtomicInteger guardedWrites = new AtomicInteger();

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(
                request,
                () -> true,
                action -> {
                    if (guardedWrites.incrementAndGet() == 1) {
                        action.run();
                        return true;
                    }
                    return false;
                }
        );

        assertThat(result.isStaleLease()).isTrue();
        verify(aiService).sendStructuredRequest(any(), any());
        verify(jobAiAnalysisMapper, never()).insert(any(com.getjobs.application.entity.JobAiAnalysisEntity.class));
        verify(bossJobDataMapper, times(1)).update(any(), any(UpdateWrapper.class));
    }

    @Test
    void manualZhilianAnalyzeApplyEndsWaitingConfirm() {
        when(zhilianJobDataMapper.selectOne(any())).thenReturn(zhilianJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult("匹配"));

        service.analyzeJob(zhilianRequest());

        List<ZhilianJobDataEntity> updates = allZhilianUpdates();
        assertThat(updates).extracting(ZhilianJobDataEntity::getDeliveryStatus)
                .contains(DeliveryStatus.AI_ANALYZING, DeliveryStatus.WAITING_CONFIRM);
        assertThat(updates.get(updates.size() - 1).getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void customThresholdAcceptsScoreExactlyAtSixty() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.getAiConfig(PROFILE_ID)).thenReturn(aiConfig(60, 50));
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult(
                "达到自定义分数线", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getScore()).isEqualTo(60);
        assertThat(result.getThreshold()).isEqualTo(60);
        assertThat(result.getDecision()).isEqualTo("APPLY");
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> schema = ArgumentCaptor.forClass(String.class);
        verify(aiService).sendStructuredRequest(prompt.capture(), schema.capture());
        assertThat(prompt.getValue()).doesNotContain("当前阈值为60");
        assertThat(schema.getValue())
                .contains("\"required\"", "\"dimensions\"", "\"hardConflicts\"", "\"additionalProperties\": false")
                .doesNotContain("\"score\"", "\"decision\"");
    }

    @Test
    void customThresholdRejectsScoreBelowSixty() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.getAiConfig(PROFILE_ID)).thenReturn(aiConfig(60, 50));
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult(
                "低于自定义分数线", "CONFLICT", "PARTIAL", "MATCH", "MATCH", "MATCH", "MATCH"));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getScore()).isEqualTo(59);
        assertThat(result.getThreshold()).isEqualTo(60);
        assertThat(result.getDecision()).isEqualTo("SKIP");
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_NOT_MATCH);
    }

    @Test
    void priorityCompanyUsesItsOwnCustomThreshold() {
        when(priorityCompanyMapper.selectList(any())).thenReturn(List.of(priorityCompany("测试公司")));
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.getAiConfig(PROFILE_ID)).thenReturn(aiConfig(60, 50));
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult(
                "达到优先公司分数线", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN", "UNKNOWN"));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getPriorityCompany()).isTrue();
        assertThat(result.getScore()).isEqualTo(60);
        assertThat(result.getThreshold()).isEqualTo(50);
        assertThat(result.getDecision()).isEqualTo("APPLY");
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void verifiedHardConflictForcesSkipEvenWhenRemainingScoreReachesThreshold() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchWithHardConflict(true));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getScore()).isEqualTo(75);
        assertThat(result.getDecision()).isEqualTo("SKIP");
        assertThat(result.getHardConflicts()).hasSize(1);
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_NOT_MATCH);
    }

    @Test
    void unverifiedHardConflictIsDowngradedToUnknown() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchWithHardConflict(false));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getDecision()).isEqualTo("APPLY");
        assertThat(result.getHardConflicts()).isEmpty();
        assertThat(result.getUnknowns()).anyMatch(value -> value.contains("降级为待核实"));
    }

    @Test
    void hardConflictMustReuseEvidenceFromAConflictDimension() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        JSONObject root = new JSONObject(batchResult("模型给出了不一致的硬冲突"));
        JSONObject conflict = new JSONObject();
        conflict.put("requirement", "经验年限不符");
        conflict.put("jobEvidence", new JSONArray(List.of("3-5年")));
        conflict.put("resumeEvidence", new JSONArray(List.of("仅1年 Java 后端开发经验")));
        root.getJSONArray("results").getJSONObject(0)
                .put("hardConflicts", new JSONArray().put(conflict));
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(root.toString());

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getDecision()).isEqualTo("APPLY");
        assertThat(result.getHardConflicts()).isEmpty();
        assertThat(result.getUnknowns()).anyMatch(value -> value.contains("冲突分项不一致"));
    }

    @Test
    void fiveJobBatchMapsByTaskIdAndRetriesOnlyMissingItem() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any()))
                .thenReturn(batchResultForTaskIds(List.of(5L, 3L, 1L, 4L), "批量结果"))
                .thenReturn(batchResultForTaskIds(List.of(2L), "单岗重试"));
        List<JobAiAnalysisService.BatchAnalysisJob> jobs = java.util.stream.LongStream.rangeClosed(1, 5)
                .mapToObj(id -> batchJob(id, bossRequest()))
                .toList();

        java.util.Map<Long, JobAiAnalysisService.AnalysisResult> results = service.analyzeJobs(jobs);

        assertThat(results).hasSize(5);
        assertThat(results.get(2L).getSummary()).isEqualTo("单岗重试");
        assertThat(results.values()).allMatch(result -> !result.isFailure());
        ArgumentCaptor<String> prompts = ArgumentCaptor.forClass(String.class);
        verify(aiService, times(2)).sendStructuredRequest(prompts.capture(), any());
        String firstPrompt = prompts.getAllValues().get(0);
        assertThat(firstPrompt.indexOf(resume().getResumeText()))
                .isEqualTo(firstPrompt.lastIndexOf(resume().getResumeText()));
    }

    @Test
    void permanentlyInvalidItemDoesNotFailOtherBatchResults() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        JSONObject first = new JSONObject(batchResultForTaskIds(
                List.of(1L, 2L, 3L, 4L, 5L), "批量结果"));
        first.getJSONArray("results").getJSONObject(1)
                .getJSONArray("dimensions").getJSONObject(0).put("status", "MAYBE");
        JSONObject retry = new JSONObject(invalidStatusBatch());
        retry.getJSONArray("results").getJSONObject(0).put("taskId", 2L);
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(first.toString(), retry.toString());
        List<JobAiAnalysisService.BatchAnalysisJob> jobs = java.util.stream.LongStream.rangeClosed(1, 5)
                .mapToObj(id -> batchJob(id, bossRequest()))
                .toList();

        java.util.Map<Long, JobAiAnalysisService.AnalysisResult> results = service.analyzeJobs(jobs);

        assertThat(results.get(2L).isFailure()).isTrue();
        assertThat(results.get(2L).getErrorCode()).isEqualTo("AI_OUTPUT_INVALID_SCHEMA");
        assertThat(results.entrySet()).filteredOn(entry -> entry.getKey() != 2L)
                .allMatch(entry -> !entry.getValue().isFailure());
        verify(aiService, times(2)).sendStructuredRequest(any(), any());
    }

    @Test
    void fiftyNormalJobsUseTenProviderCalls() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        AtomicInteger providerBatch = new AtomicInteger();
        when(aiService.sendStructuredRequest(any(), any())).thenAnswer(invocation -> {
            long firstId = providerBatch.getAndIncrement() * 5L + 1L;
            return batchResultForTaskIds(java.util.stream.LongStream.range(firstId, firstId + 5)
                    .boxed().toList(), "批量结果");
        });

        for (int batch = 0; batch < 10; batch++) {
            long firstId = batch * 5L + 1L;
            List<JobAiAnalysisService.BatchAnalysisJob> jobs = java.util.stream.LongStream
                    .range(firstId, firstId + 5)
                    .mapToObj(id -> batchJob(id, bossRequest()))
                    .toList();
            assertThat(service.analyzeJobs(jobs)).hasSize(5);
        }

        assertThat(providerBatch.get()).isEqualTo(10);
        verify(aiService, times(10)).sendStructuredRequest(any(), any());
    }

    @Test
    void savesConfirmedUtf8ResumeText() {
        when(profileService.getCurrentProfileId()).thenReturn(PROFILE_ID);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(PROFILE_ID);
        when(resumeProfileMapper.selectOne(any())).thenReturn(null);
        ResumeProfileEntity result = service.saveResumeText(
                "中文简历：熟悉 Java 和 Spring Boot",
                "简历.txt",
                "local_parsed",
                "用户已确认识别预览"
        );

        assertThat(result.getResumeText()).contains("熟悉 Java");
        assertThat(result.getSourceFilename()).isEqualTo("简历.txt");
        assertThat(result.getParseStatus()).isEqualTo("local_parsed");
    }

    @Test
    void repairsMarkdownWrappedAiJsonAndKeepsWaitingConfirmFlow() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(
                "```json\n" + batchResult("匹配") + "\n```");

        service.analyzeJob(bossRequest());

        BossJobDataEntity update = lastBossUpdate();
        assertThat(update.getAiScore()).isEqualTo(100);
        assertThat(update.getAiDecision()).isEqualTo("APPLY");
        assertThat(update.getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void keepsChineseCurlyQuotesInsideValidJsonString() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult("岗位要求“3年以上”经验"));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isFalse();
        assertThat(result.getSummary()).isEqualTo("岗位要求“3年以上”经验");
        verify(aiService).sendStructuredRequest(any(), any());
    }

    @Test
    void emptyProviderOutputBecomesExplicitAiFailureInsteadOfSkip() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn("   ");

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isTrue();
        assertThat(result.getErrorCode()).isEqualTo("AI_OUTPUT_EMPTY");
        assertThat(result.isProviderOutcomeUnknown()).isFalse();
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_ANALYSIS_FAILED);
    }

    @Test
    void missingRequiredOutputFieldBecomesExplicitAiFailure() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(
                missingGreetingBatch(), missingGreetingBatch());

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isTrue();
        assertThat(result.getErrorCode()).isEqualTo("AI_OUTPUT_MISSING_FIELD");
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_ANALYSIS_FAILED);
        verify(aiService, times(2)).sendStructuredRequest(any(), any());
    }

    @Test
    void invalidDimensionStatusAndArrayElementTypesAreRetriedThenRejected() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any()))
                .thenReturn(invalidStatusBatch(), invalidStatusBatch())
                .thenReturn(invalidMatchesBatch(), invalidMatchesBatch());

        JobAiAnalysisService.AnalysisResult invalidStatus = service.analyzeJob(bossRequest());
        JobAiAnalysisService.AnalysisResult invalidArray = service.analyzeJob(bossRequest());

        assertThat(invalidStatus.getErrorCode()).isEqualTo("AI_OUTPUT_INVALID_SCHEMA");
        assertThat(invalidArray.getErrorCode()).isEqualTo("AI_OUTPUT_INVALID_SCHEMA");
        verify(aiService, times(4)).sendStructuredRequest(any(), any());
    }

    @Test
    void invalidJsonRetriesOnceWithSameSchemaAndCanSucceed() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any()))
                .thenReturn("not-json-at-all")
                .thenReturn(batchResult("重试成功"));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isFalse();
        assertThat(result.getSummary()).isEqualTo("重试成功");
        ArgumentCaptor<String> schema = ArgumentCaptor.forClass(String.class);
        verify(aiService, times(2)).sendStructuredRequest(any(), schema.capture());
        assertThat(schema.getAllValues()).hasSize(2).allMatch(schema.getAllValues().get(0)::equals);
    }

    @Test
    void oneExpiredLeaseDoesNotDiscardOtherJobsDuringWholeBatchRetry() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        AtomicBoolean secondLeaseCurrent = new AtomicBoolean(true);
        when(aiService.sendStructuredRequest(any(), any()))
                .thenAnswer(invocation -> {
                    secondLeaseCurrent.set(false);
                    return "not-json-at-all";
                })
                .thenReturn(batchResultForTaskIds(List.of(1L, 2L), "重试后有效"));
        JobAiAnalysisService.BatchAnalysisJob first = batchJob(1L, bossRequest());
        JobAiAnalysisService.BatchAnalysisJob second = new JobAiAnalysisService.BatchAnalysisJob(
                2L,
                bossRequest(),
                secondLeaseCurrent::get,
                action -> {
                    action.run();
                    return true;
                }
        );

        java.util.Map<Long, JobAiAnalysisService.AnalysisResult> results =
                service.analyzeJobs(List.of(first, second));

        assertThat(results.get(1L).isFailure()).isFalse();
        assertThat(results.get(1L).getSummary()).isEqualTo("重试后有效");
        assertThat(results.get(2L).isStaleLease()).isTrue();
        verify(aiService, times(2)).sendStructuredRequest(any(), any());
    }

    @Test
    void invalidJsonFailsAfterExactlyOneRetry() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn("bad-json", "still-bad-json");

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isTrue();
        assertThat(result.getErrorCode()).isEqualTo("AI_OUTPUT_INVALID_JSON");
        verify(aiService, times(2)).sendStructuredRequest(any(), any());
    }

    @Test
    void invalidDimensionStatusRetriesOnlyThatJobOnce() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(
                invalidStatusBatch(), invalidStatusBatch());

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getErrorCode()).isEqualTo("AI_OUTPUT_INVALID_SCHEMA");
        verify(aiService, times(2)).sendStructuredRequest(any(), any());
    }

    @Test
    void rawProviderResponseIsReplacedWithDiagnosticFingerprint() {
        String marker = "sensitive-response-marker";
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult(marker));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isFalse();
        ArgumentCaptor<JobAiAnalysisEntity> captor = ArgumentCaptor.forClass(JobAiAnalysisEntity.class);
        verify(jobAiAnalysisMapper).insert(captor.capture());
        assertThat(captor.getValue().getRawResponse())
                .contains("provider_response_fingerprint", "sha256", "length")
                .doesNotContain(marker);
    }

    @Test
    void persistenceFailureNeverReportsTaskSuccess() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(jobAiAnalysisMapper.insert(any(JobAiAnalysisEntity.class))).thenReturn(0);
        when(bossJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1, 0, 1);
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult("匹配"));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isTrue();
        assertThat(result.getErrorCode()).isEqualTo("AI_PERSISTENCE_FAILED");
        assertThat(result.isProviderOutcomeUnknown()).isTrue();
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.AI_ANALYSIS_FAILED);
    }

    @Test
    void platformWriteFailureCanBeConfirmedAndRetriedWithoutGettingStuckAnalyzing() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.AI_ANALYZING));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(bossJobDataMapper.update(any(), any(UpdateWrapper.class))).thenReturn(1, 0, 1, 1, 1);
        when(aiService.sendStructuredRequest(any(), any())).thenReturn(batchResult("匹配"));

        JobAiAnalysisService.AnalysisResult firstResult = service.analyzeJob(bossRequest());
        JobAiAnalysisService.AnalysisResult confirmedRetryResult = service.analyzeJob(bossRequest());

        assertThat(firstResult.isFailure()).isTrue();
        assertThat(firstResult.getErrorCode()).isEqualTo("AI_PLATFORM_WRITE_FAILED");
        assertThat(firstResult.isProviderOutcomeUnknown()).isTrue();
        assertThat(confirmedRetryResult.isFailure()).isFalse();
        List<BossJobDataEntity> updates = allBossUpdates();
        assertThat(updates).extracting(BossJobDataEntity::getDeliveryStatus)
                .containsSequence(
                        DeliveryStatus.AI_ANALYZING,
                        DeliveryStatus.WAITING_CONFIRM,
                        DeliveryStatus.AI_ANALYSIS_FAILED,
                        DeliveryStatus.AI_ANALYZING,
                        DeliveryStatus.WAITING_CONFIRM
                );
        verify(aiService, times(2)).sendStructuredRequest(any(), any());
    }

    @Test
    void providerTimeoutIsPersistedAsUnknownOutcome() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendStructuredRequest(any(), any())).thenThrow(new AiProviderException(
                AiProviderException.Code.TIMEOUT,
                "AI Provider 请求超时（requestId=test-request）",
                null,
                "test-request",
                "",
                true,
                null
        ));

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.isFailure()).isTrue();
        assertThat(result.getErrorCode()).isEqualTo("AI_PROVIDER_TIMEOUT");
        assertThat(result.isProviderOutcomeUnknown()).isTrue();
    }

    @Test
    void deliveryFailureStatusKeepsFailureTypeAndReason() {
        ZhilianService zhilianService = new ZhilianService(null, null, zhilianJobDataMapper, null, profileService);

        zhilianService.updateDeliveryStatusByJobId("z1", DeliveryStatus.DELIVERY_FAILED, PROFILE_ID, "PAGE_ERROR", "按钮不可点击");

        ZhilianJobDataEntity update = lastZhilianUpdate();
        assertThat(update.getDeliveryStatus()).isEqualTo(DeliveryStatus.DELIVERY_FAILED);
        assertThat(update.getFailureType()).isEqualTo("PAGE_ERROR");
        assertThat(update.getFailureReason()).isEqualTo("按钮不可点击");
    }

    @Test
    void zhilianUpdateByIdCanSkipAndKeepFailureDetails() {
        ZhilianService zhilianService = new ZhilianService(null, null, zhilianJobDataMapper, null, profileService);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(PROFILE_ID);
        when(zhilianJobDataMapper.selectOne(any())).thenReturn(zhilianJob(DeliveryStatus.WAITING_CONFIRM));

        zhilianService.updateDeliveryStatusById(1L, DeliveryStatus.SKIPPED);
        assertThat(lastZhilianUpdateById().getDeliveryStatus()).isEqualTo(DeliveryStatus.SKIPPED);

        zhilianService.updateDeliveryStatusById(1L, DeliveryStatus.DELIVERY_FAILED, "PAGE_ERROR", "按钮不可点击");
        ZhilianJobDataEntity failureUpdate = lastZhilianUpdateById();
        assertThat(failureUpdate.getDeliveryStatus()).isEqualTo(DeliveryStatus.DELIVERY_FAILED);
        assertThat(failureUpdate.getFailureType()).isEqualTo("PAGE_ERROR");
        assertThat(failureUpdate.getFailureReason()).isEqualTo("按钮不可点击");
    }

    private JobAiAnalysisService.JobAnalysisRequest bossRequest() {
        JobAiAnalysisService.JobAnalysisRequest request = baseRequest("boss");
        request.setJobKey("boss1");
        return request;
    }

    private JobAiAnalysisService.JobAnalysisRequest zhilianRequest() {
        JobAiAnalysisService.JobAnalysisRequest request = baseRequest("zhilian");
        request.setJobKey("z1");
        return request;
    }

    private JobAiAnalysisService.JobAnalysisRequest legacyRequest(String platform, Long rowId, String jobKey) {
        JobAiAnalysisService.JobAnalysisRequest request = baseRequest(platform);
        request.setJobRowId(rowId);
        request.setJobKey(jobKey);
        return request;
    }

    private JobAiAnalysisService.JobAnalysisRequest baseRequest(String platform) {
        JobAiAnalysisService.JobAnalysisRequest request = new JobAiAnalysisService.JobAnalysisRequest();
        request.setProfileId(PROFILE_ID);
        request.setPlatform(platform);
        request.setCompanyName("测试公司");
        request.setJobName("Java工程师");
        request.setSalary("20-30K");
        request.setLocation("深圳");
        request.setExperience("3-5年");
        request.setDegree("本科");
        request.setJobDescription("负责后端系统设计开发，要求 Java Spring Boot 经验。");
        request.setScanRunId("run1");
        return request;
    }

    private JobAiAnalysisService.AnalysisResult analysis(String decision) {
        JobAiAnalysisService.AnalysisResult result = new JobAiAnalysisService.AnalysisResult();
        result.setScore("APPLY".equals(decision) ? 90 : 20);
        result.setDecision(decision);
        result.setSummary("summary");
        result.setStrengths(List.of());
        result.setRisks(List.of());
        result.setGreeting("");
        return result;
    }

    private JobAiAnalysisService.BatchAnalysisJob batchJob(
            long taskId, JobAiAnalysisService.JobAnalysisRequest request) {
        return new JobAiAnalysisService.BatchAnalysisJob(taskId, request, () -> true, action -> {
            action.run();
            return true;
        });
    }

    private String batchResult(String summary, String... statuses) {
        return batchResultForTaskIds(List.of(1L), summary, statuses);
    }

    private String batchResultForTaskIds(List<Long> taskIds, String summary, String... statuses) {
        List<String> keys = List.of(
                "CORE_SKILLS",
                "RELEVANT_EXPERIENCE",
                "ACHIEVEMENTS_COMPLEXITY",
                "INDUSTRY_TRANSFER",
                "EDUCATION_TENURE",
                "LOCATION_SALARY"
        );
        JSONArray results = new JSONArray();
        for (Long taskId : taskIds) {
            JSONObject item = new JSONObject();
            item.put("taskId", taskId);
            item.put("summary", summary);
            item.put("matches", new JSONArray(List.of("岗位与简历均提到 Java")));
            item.put("gaps", new JSONArray());
            item.put("unknowns", new JSONArray());
            JSONArray dimensions = new JSONArray();
            for (int index = 0; index < keys.size(); index++) {
                JSONObject dimension = new JSONObject();
                dimension.put("key", keys.get(index));
                dimension.put("status", index < statuses.length ? statuses[index] : "MATCH");
                dimension.put("jobEvidence", new JSONArray(List.of("Java")));
                dimension.put("resumeEvidence", new JSONArray(List.of("Java")));
                dimension.put("note", "证据说明");
                dimensions.put(dimension);
            }
            item.put("dimensions", dimensions);
            item.put("hardConflicts", new JSONArray());
            item.put("greeting", "你好");
            results.put(item);
        }
        return new JSONObject().put("results", results).toString();
    }

    private String batchWithHardConflict(boolean withResumeEvidence) {
        JSONObject root = new JSONObject(batchResult("存在硬性条件差异"));
        JSONObject experienceDimension = root.getJSONArray("results").getJSONObject(0)
                .getJSONArray("dimensions").getJSONObject(1);
        experienceDimension.put("status", "CONFLICT");
        experienceDimension.put("jobEvidence", new JSONArray(List.of("3-5年")));
        experienceDimension.put("resumeEvidence", new JSONArray(List.of("仅1年 Java 后端开发经验")));
        JSONObject conflict = new JSONObject();
        conflict.put("requirement", "经验年限不符");
        conflict.put("jobEvidence", new JSONArray(List.of("3-5年")));
        conflict.put("resumeEvidence", withResumeEvidence
                ? new JSONArray(List.of("仅1年 Java 后端开发经验"))
                : new JSONArray());
        root.getJSONArray("results").getJSONObject(0)
                .put("hardConflicts", new JSONArray().put(conflict));
        return root.toString();
    }

    private String missingGreetingBatch() {
        JSONObject root = new JSONObject(batchResult("缺少字段"));
        root.getJSONArray("results").getJSONObject(0).remove("greeting");
        return root.toString();
    }

    private String invalidStatusBatch() {
        JSONObject root = new JSONObject(batchResult("状态非法"));
        root.getJSONArray("results").getJSONObject(0)
                .getJSONArray("dimensions").getJSONObject(0).put("status", "MAYBE");
        return root.toString();
    }

    private String invalidMatchesBatch() {
        JSONObject root = new JSONObject(batchResult("数组非法"));
        root.getJSONArray("results").getJSONObject(0).put("matches", new JSONArray().put(1));
        return root.toString();
    }

    private BossJobDataEntity bossJob(String status) {
        BossJobDataEntity job = new BossJobDataEntity();
        job.setId(1L);
        job.setProfileId(PROFILE_ID);
        job.setEncryptId("boss1");
        job.setCompanyName("测试公司");
        job.setJobName("Java工程师");
        job.setDeliveryStatus(status);
        return job;
    }

    private ZhilianJobDataEntity zhilianJob(String status) {
        ZhilianJobDataEntity job = new ZhilianJobDataEntity();
        job.setId(1L);
        job.setProfileId(PROFILE_ID);
        job.setJobId("z1");
        job.setCompanyName("测试公司");
        job.setJobTitle("Java工程师");
        job.setDeliveryStatus(status);
        return job;
    }

    private ResumeProfileEntity resume() {
        ResumeProfileEntity resume = new ResumeProfileEntity();
        resume.setProfileId(PROFILE_ID);
        resume.setResumeText("仅1年 Java 后端开发经验，熟悉 Spring Boot 和招聘业务系统。");
        return resume;
    }

    private AiEntity aiConfig(int applyThreshold, int priorityApplyThreshold) {
        AiEntity config = new AiEntity();
        config.setProfileId(PROFILE_ID);
        config.setApplyThreshold(applyThreshold);
        config.setPriorityApplyThreshold(priorityApplyThreshold);
        return config;
    }

    private PriorityCompanyEntity priorityCompany(String companyName) {
        PriorityCompanyEntity company = new PriorityCompanyEntity();
        company.setProfileId(PROFILE_ID);
        company.setCompanyName(companyName);
        company.setEnabled(1);
        return company;
    }

    private BossJobDataEntity lastBossUpdate() {
        List<BossJobDataEntity> values = allBossUpdates();
        return values.get(values.size() - 1);
    }

    private List<BossJobDataEntity> allBossUpdates() {
        ArgumentCaptor<BossJobDataEntity> captor = ArgumentCaptor.forClass(BossJobDataEntity.class);
        verify(bossJobDataMapper, atLeastOnce()).update(captor.capture(), any(UpdateWrapper.class));
        return captor.getAllValues();
    }

    private ZhilianJobDataEntity lastZhilianUpdate() {
        List<ZhilianJobDataEntity> values = allZhilianUpdates();
        return values.get(values.size() - 1);
    }

    private List<ZhilianJobDataEntity> allZhilianUpdates() {
        ArgumentCaptor<ZhilianJobDataEntity> captor = ArgumentCaptor.forClass(ZhilianJobDataEntity.class);
        verify(zhilianJobDataMapper, atLeastOnce()).update(captor.capture(), any(UpdateWrapper.class));
        return captor.getAllValues();
    }

    private ZhilianJobDataEntity lastZhilianUpdateById() {
        ArgumentCaptor<ZhilianJobDataEntity> captor = ArgumentCaptor.forClass(ZhilianJobDataEntity.class);
        verify(zhilianJobDataMapper, atLeastOnce()).updateById(captor.capture());
        List<ZhilianJobDataEntity> values = captor.getAllValues();
        return values.get(values.size() - 1);
    }
}
