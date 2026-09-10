package com.getjobs.application.service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.mapper.ZhilianJobDataMapper;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.time.LocalDateTime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class ZhilianServiceCrossRunUpsertTest {
    @Test
    void incompleteRescanPreservesPreviouslyCollectedCoreFieldsAndDescription() {
        ProfileService profiles = mock(ProfileService.class);
        ZhilianJobDataMapper mapper = mock(ZhilianJobDataMapper.class);
        ZhilianService service = new ZhilianService(null, null, mapper, null, profiles);
        ZhilianJobDataEntity existing = new ZhilianJobDataEntity();
        existing.setId(11L);
        existing.setJobId("CC100J200");
        existing.setJobTitle("产品运营");
        existing.setCompanyName("招聘公司");
        existing.setJobLink("https://www.zhaopin.com/jobdetail/CC100J200.htm");
        existing.setSalary("8000-12000元");
        existing.setLocation("北京");
        existing.setExperience("3-5年");
        existing.setDegree("本科");
        existing.setJobDescription("岗位职责：负责人工智能产品运营、需求收集与分析、客户培训和效果跟踪。任职要求：本科，三年以上经验。");
        when(mapper.selectOne(any(Wrapper.class))).thenReturn(existing);
        when(mapper.selectById(11L)).thenReturn(existing);
        ZhilianJobDataEntity incoming = new ZhilianJobDataEntity();
        incoming.setJobId("CC100J200");
        incoming.setSalary(" ");
        incoming.setJobDescription("列表摘要");
        service.upsertChromeJob(incoming, "rescan", 7L);
        ArgumentCaptor<ZhilianJobDataEntity> captor = ArgumentCaptor.forClass(ZhilianJobDataEntity.class);
        verify(mapper).updateById(captor.capture());
        ZhilianJobDataEntity updated = captor.getValue();
        assertThat(updated.getJobTitle()).isEqualTo(existing.getJobTitle());
        assertThat(updated.getJobLink()).isEqualTo(existing.getJobLink());
        assertThat(updated.getCompanyName()).isEqualTo(existing.getCompanyName());
        assertThat(updated.getSalary()).isEqualTo(existing.getSalary());
        assertThat(updated.getLocation()).isEqualTo(existing.getLocation());
        assertThat(updated.getExperience()).isEqualTo(existing.getExperience());
        assertThat(updated.getDegree()).isEqualTo(existing.getDegree());
        assertThat(updated.getJobDescription()).isEqualTo(existing.getJobDescription());
    }

    @Test
    void sameJobAcrossScanRunsUpdatesExistingRowAndPreservesWorkflowState() {
        ProfileService profileService = mock(ProfileService.class);
        ZhilianJobDataMapper mapper = mock(ZhilianJobDataMapper.class);
        ZhilianService service = new ZhilianService(null, null, mapper, null, profileService);
        when(profileService.getCurrentProfileId()).thenReturn(7L);

        ZhilianJobDataEntity existing = new ZhilianJobDataEntity();
        existing.setId(11L);
        existing.setProfileId(7L);
        existing.setJobId("stable-job-key");
        existing.setScanRunId("run-old");
        existing.setDeliveryStatus(DeliveryStatus.WAITING_CONFIRM);
        existing.setAiScore(92);
        existing.setAiDecision("APPLY");
        existing.setAiReason("匹配");
        existing.setPriorityCompany(1);
        existing.setCreateTime(LocalDateTime.now().minusDays(1));
        when(mapper.selectOne(any(Wrapper.class))).thenReturn(existing);
        when(mapper.updateById(any(ZhilianJobDataEntity.class))).thenReturn(1);
        when(mapper.selectById(11L)).thenAnswer(invocation -> existing);

        ZhilianJobDataEntity incoming = new ZhilianJobDataEntity();
        incoming.setJobId("stable-job-key");
        incoming.setJobTitle("Java 工程师");
        incoming.setCompanyName("示例公司");
        incoming.setDeliveryStatus(DeliveryStatus.NOT_DELIVERED);

        service.upsertChromeJob(incoming, "run-new");

        ArgumentCaptor<ZhilianJobDataEntity> captor = ArgumentCaptor.forClass(ZhilianJobDataEntity.class);
        verify(mapper).updateById(captor.capture());
        verify(mapper, never()).insert(any(ZhilianJobDataEntity.class));
        ZhilianJobDataEntity updated = captor.getValue();
        assertThat(updated.getId()).isEqualTo(11L);
        assertThat(updated.getScanRunId()).isEqualTo("run-new");
        assertThat(updated.getDeliveryStatus()).isEqualTo(DeliveryStatus.WAITING_CONFIRM);
        assertThat(updated.getAiScore()).isEqualTo(92);
        assertThat(updated.getAiDecision()).isEqualTo("APPLY");
        assertThat(updated.getAiReason()).isEqualTo("匹配");
        assertThat(updated.getPriorityCompany()).isEqualTo(1);
    }

    @Test
    void differentStableIdsWithSameCompanyAndTitleCreateSeparateRows() {
        ProfileService profileService = mock(ProfileService.class);
        ZhilianJobDataMapper mapper = mock(ZhilianJobDataMapper.class);
        ZhilianService service = new ZhilianService(null, null, mapper, null, profileService);
        when(mapper.selectOne(any(Wrapper.class))).thenReturn(null);
        when(mapper.insert(any(ZhilianJobDataEntity.class))).thenReturn(1);

        ZhilianJobDataEntity incoming = new ZhilianJobDataEntity();
        incoming.setJobId("stable-new");
        incoming.setJobTitle("相同岗位");
        incoming.setCompanyName("相同公司");

        ZhilianJobDataEntity saved = service.upsertChromeJob(incoming, "run-new", 7L);

        verify(mapper).insert(incoming);
        verify(mapper, never()).updateById(any(ZhilianJobDataEntity.class));
        assertThat(saved.getJobId()).isEqualTo("stable-new");
        assertThat(saved.getProfileId()).isEqualTo(7L);
    }
}
