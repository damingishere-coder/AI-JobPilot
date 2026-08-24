package com.getjobs.application.controller;

import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.service.DeliveryAttemptService;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.ZhilianService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ZhilianDeliveryControllerTest {
    private ZhilianService zhilianService;
    private DeliveryAttemptService deliveryAttemptService;
    private ZhilianController controller;

    @BeforeEach
    void setUp() {
        zhilianService = mock(ZhilianService.class);
        deliveryAttemptService = mock(DeliveryAttemptService.class);
        controller = new ZhilianController();
        ReflectionTestUtils.setField(controller, "zhilianService", zhilianService);
        ReflectionTestUtils.setField(controller, "deliveryAttemptService", deliveryAttemptService);
    }

    @Test
    void deliveryCallbackPassesRequestIdentityAndEvidenceToAttemptService() {
        ZhilianJobDataEntity job = new ZhilianJobDataEntity();
        job.setId(8L);
        job.setProfileId(1L);
        job.setJobId("zhilian-8");
        job.setDeliveryStatus(DeliveryStatus.DELIVERY_REQUESTED);
        when(zhilianService.getZhilianJobById(8L)).thenReturn(job);
        when(deliveryAttemptService.resolve(
                "zhilian", 1L, 8L, "request-8", DeliveryAttemptService.State.UNKNOWN,
                DeliveryAttemptService.NO_CONFIRMATION, "未出现明确结果", null, "未出现明确结果"
        )).thenReturn(new DeliveryAttemptService.ResolutionResult(
                true, false, DeliveryAttemptService.State.UNKNOWN, "投递结果已写入"));

        DeliveryResultRequest request = new DeliveryResultRequest();
        request.setRequestKey("request-8");
        request.setOutcome("UNKNOWN");
        request.setEvidence(DeliveryAttemptService.NO_CONFIRMATION);
        request.setMessage("未出现明确结果");

        Map<String, Object> response = controller.updateZhilianDeliveryResult(8L, request);

        assertThat(response)
                .containsEntry("success", true)
                .containsEntry("state", "UNKNOWN");
    }
}
