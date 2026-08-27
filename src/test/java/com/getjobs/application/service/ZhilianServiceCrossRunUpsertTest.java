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
}
