package com.getjobs.application.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {
    @Test
    void preservesServerStatusWithoutExposingInternalReason() {
        ResponseEntity<Map<String, Object>> response = new GlobalExceptionHandler()
                .handleResponseStatus(new org.springframework.web.server.ResponseStatusException(
                        org.springframework.http.HttpStatus.SERVICE_UNAVAILABLE, "secret-token-internal-detail"));
        assertThat(response.getStatusCode().value()).isEqualTo(503);
        assertThat(response.getBody()).containsEntry("errorCode", "INTERNAL_ERROR")
                .doesNotContainValue("secret-token-internal-detail");
    }

    @Test
    void mapsKeywordLimitValidationToBadRequest() {
        ResponseEntity<Map<String, Object>> response = new GlobalExceptionHandler()
                .handleIllegalArgument(new IllegalArgumentException("岗位关键词最多选择8个"));

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("errorCode", "INVALID_REQUEST")
                .containsKey("requestId")
                .containsEntry("message", "岗位关键词最多选择8个");
    }

    @Test
    void mapsUnknownFailuresToTheSameJsonEnvelopeWithoutLeakingDetails() {
        ResponseEntity<Map<String, Object>> response = new GlobalExceptionHandler()
                .handleUnknown(new RuntimeException("secret-token-internal-detail"));

        assertThat(response.getStatusCode().value()).isEqualTo(500);
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("errorCode", "INTERNAL_ERROR")
                .containsKey("requestId")
                .doesNotContainValue("secret-token-internal-detail");
    }
}
