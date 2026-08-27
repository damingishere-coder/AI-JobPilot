package com.getjobs.application.controller;

import com.getjobs.application.dto.DeliveryResultRequest;
import com.getjobs.application.dto.GreetingConfirmationRequest;
import com.getjobs.application.entity.ZhilianJobDataEntity;
import com.getjobs.application.service.DeliveryAttemptService;
import com.getjobs.application.service.DeliveryStatus;
import com.getjobs.application.service.ZhilianService;
import com.getjobs.application.service.GreetingDraftService;
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
    private GreetingDraftService greetingDraftService;
    private ZhilianController controller;

    @BeforeEach
    void setUp() {
        zhilianService = mock(ZhilianService.class);
        deliveryAttemptService = mock(DeliveryAttemptService.class);
        greetingDraftService = mock(GreetingDraftService.class);
        controller = new ZhilianController();
        ReflectionTestUtils.setField(controller, "zhilianService", zhilianService);
        ReflectionTestUtils.setField(controller, "deliveryAttemptService", deliveryAttemptService);
        ReflectionTestUtils.setField(controller, "greetingDraftService", greetingDraftService);
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

    @Test
    void confirmTaskCarriesTheExactReviewedGreeting() {
        ZhilianJobDataEntity job = new ZhilianJobDataEntity();
        job.setId(9L);
        job.setProfileId(1L);
        job.setJobId("zhilian-9");
        job.setJobLink("https://sou.zhaopin.com/job/9");
        job.setDeliveryStatus(DeliveryStatus.WAITING_CONFIRM);
        when(zhilianService.getZhilianJobById(9L)).thenReturn(job);
        when(greetingDraftService.resolveForJob("zhilian", 9L)).thenReturn(
                new GreetingDraftService.GreetingView("AI 原稿", "人工稿", GreetingDraftService.USER_EDITED, null, "人工确认稿"));
        when(deliveryAttemptService.requestZhilian(9L, 1L, "zhilian-9")).thenReturn(
                new DeliveryAttemptService.RequestResult(true, true, "request-9", DeliveryAttemptService.State.REQUESTED, "已创建"));
        when(deliveryAttemptService.snapshotGreeting("request-9", "人工确认稿")).thenReturn("人工确认稿");

        GreetingConfirmationRequest request = new GreetingConfirmationRequest();
        request.setGreetingSnapshot("人工确认稿");
        Map<String, Object> response = controller.confirmZhilianJob(9L, request);

        @SuppressWarnings("unchecked")
        Map<String, Object> task = (Map<String, Object>) response.get("task");
        assertThat(task)
                .containsEntry("requestKey", "request-9")
                .containsEntry("greeting", "人工确认稿")
                .containsEntry("greetingSource", GreetingDraftService.USER_EDITED);
    }
}
