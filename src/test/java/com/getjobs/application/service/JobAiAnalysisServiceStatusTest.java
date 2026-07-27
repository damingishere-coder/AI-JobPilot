package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper;
import com.getjobs.application.entity.AiEntity;
import com.getjobs.application.entity.BossJobDataEntity;
import com.getjobs.application.entity.PriorityCompanyEntity;
import com.getjobs.application.entity.ResumeProfileEntity;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.BossJobDataMapper;
import com.getjobs.application.mapper.JobAiAnalysisMapper;
import com.getjobs.application.mapper.PriorityCompanyMapper;
import com.getjobs.application.mapper.ResumeProfileMapper;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mock.web.MockMultipartFile;

import java.nio.charset.StandardCharsets;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.atLeastOnce;
import static org.mockito.Mockito.lenient;
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
                zhilianJobDataMapper
        );
        lenient().when(priorityCompanyMapper.selectList(any())).thenReturn(List.of());
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
    void deliveredJobKeepsStatusWhenAnalyzedAgain() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.DELIVERED));

        service.updatePlatformCache(bossRequest(), analysis("SKIP"));

        assertThat(lastBossUpdate().getDeliveryStatus()).isNull();
    }

    @Test
    void manualZhilianAnalyzeApplyEndsWaitingConfirm() {
        when(zhilianJobDataMapper.selectOne(any())).thenReturn(zhilianJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendRequest(any())).thenReturn("""
                {"score":90,"decision":"APPLY","summary":"匹配","strengths":["经验匹配"],"risks":[],"greeting":"你好"}
                """);

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
        when(aiService.sendRequest(any())).thenReturn("""
                {"score":60,"decision":"SKIP","summary":"达到自定义分数线","strengths":[],"risks":[],"greeting":"你好"}
                """);

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getScore()).isEqualTo(60);
        assertThat(result.getThreshold()).isEqualTo(60);
        assertThat(result.getDecision()).isEqualTo("APPLY");
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
        ArgumentCaptor<String> prompt = ArgumentCaptor.forClass(String.class);
        verify(aiService).sendRequest(prompt.capture());
        assertThat(prompt.getValue()).contains("当前阈值为60");
    }

    @Test
    void customThresholdRejectsScoreBelowSixty() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.getAiConfig(PROFILE_ID)).thenReturn(aiConfig(60, 50));
        when(aiService.sendRequest(any())).thenReturn("""
                {"score":59,"decision":"APPLY","summary":"低于自定义分数线","strengths":[],"risks":[],"greeting":"你好"}
                """);

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
        when(aiService.sendRequest(any())).thenReturn("""
                {"score":50,"decision":"SKIP","summary":"达到优先公司分数线","strengths":[],"risks":[],"greeting":"你好"}
                """);

        JobAiAnalysisService.AnalysisResult result = service.analyzeJob(bossRequest());

        assertThat(result.getPriorityCompany()).isTrue();
        assertThat(result.getThreshold()).isEqualTo(50);
        assertThat(result.getDecision()).isEqualTo("APPLY");
        assertThat(lastBossUpdate().getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
    }

    @Test
    void parsesUtf8ResumeTextFile() {
        when(profileService.getCurrentProfileId()).thenReturn(PROFILE_ID);
        when(profileService.getCurrentProfileIdOrNull()).thenReturn(PROFILE_ID);
        when(resumeProfileMapper.selectOne(any())).thenReturn(null);
        MockMultipartFile file = new MockMultipartFile(
                "file",
                "简历.txt",
                "text/plain",
                "中文简历：熟悉 Java 和 Spring Boot".getBytes(StandardCharsets.UTF_8)
        );

        ResumeProfileEntity result = service.parseAndSaveResumeFile(file);

        assertThat(result.getResumeText()).contains("熟悉 Java");
        assertThat(result.getSourceFilename()).isEqualTo("简历.txt");
        assertThat(result.getParseStatus()).isEqualTo("parsed");
    }

    @Test
    void repairsMarkdownWrappedAiJsonAndKeepsWaitingConfirmFlow() {
        when(bossJobDataMapper.selectOne(any())).thenReturn(bossJob(DeliveryStatus.NOT_DELIVERED));
        when(resumeProfileMapper.selectOne(any())).thenReturn(resume());
        when(aiService.sendRequest(any())).thenReturn("""
                ```json
                {score:88, decision:"APPLY", summary:"匹配", strengths:["Java"], risks:[], greeting:"你好",}
                ```
                """);

        service.analyzeJob(bossRequest());

        BossJobDataEntity update = lastBossUpdate();
        assertThat(update.getAiScore()).isEqualTo(88);
        assertThat(update.getAiDecision()).isEqualTo("APPLY");
        assertThat(update.getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
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
        resume.setResumeText("多年 Java 后端开发经验，熟悉 Spring Boot 和招聘业务系统。");
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
        ArgumentCaptor<BossJobDataEntity> captor = ArgumentCaptor.forClass(BossJobDataEntity.class);
        verify(bossJobDataMapper, atLeastOnce()).update(captor.capture(), any(UpdateWrapper.class));
        List<BossJobDataEntity> values = captor.getAllValues();
        return values.get(values.size() - 1);
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
