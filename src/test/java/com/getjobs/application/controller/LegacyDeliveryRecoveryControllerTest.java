package com.getjobs.application.controller;

import com.getjobs.application.service.CookieService;
import com.getjobs.application.service.DeliveryAttemptService;
import com.getjobs.application.service.Job51Service;
import com.getjobs.application.service.LiepinService;
import com.getjobs.worker.manager.PlaywrightManager;
import com.getjobs.worker.service.Job51JobService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

class LegacyDeliveryRecoveryControllerTest {

    @Test
    void job51ReconcileAndRetryHaveRealHttpContracts() throws Exception {
        DeliveryAttemptService attempts = mock(DeliveryAttemptService.class);
        when(attempts.reconcileLatestLegacy("51job", 101L, DeliveryAttemptService.State.CONFIRMED, "人工核对"))
                .thenReturn(new DeliveryAttemptService.ResolutionResult(
                        true, false, DeliveryAttemptService.State.CONFIRMED, "已对账"));
        when(attempts.prepareLegacyRetry("51job", 101L))
                .thenReturn(new DeliveryAttemptService.RequestResult(true, false, null, null, "已准备重试"));
        JobController controller = new JobController(
                mock(Job51Service.class),
                mock(Job51JobService.class),
                mock(PlaywrightManager.class),
                mock(CookieService.class),
                attempts
        );
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller).build();

        mvc.perform(post("/api/51job/jobs/101/delivery-reconcile")
                        .contentType("application/json")
                        .content("{\"outcome\":\"CONFIRMED\",\"message\":\"人工核对\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.state").value("CONFIRMED"));
        mvc.perform(post("/api/51job/jobs/101/delivery-retry"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.prepared").value(true));
    }

    @Test
    void liepinRejectsInvalidManualOutcomeThroughHttpBinding() throws Exception {
        DeliveryAttemptService attempts = mock(DeliveryAttemptService.class);
        when(attempts.reconcileLatestLegacy("liepin", 202L, null, "非法状态"))
                .thenReturn(new DeliveryAttemptService.ResolutionResult(false, false, null, "人工对账状态无效"));
        LiepinController controller = new LiepinController();
        ReflectionTestUtils.setField(controller, "deliveryAttemptService", attempts);
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller).build();

        mvc.perform(post("/api/liepin/jobs/202/delivery-reconcile")
                        .contentType("application/json")
                        .content("{\"outcome\":\"INVALID\",\"message\":\"非法状态\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.message").value("人工对账状态无效"));
    }
}
