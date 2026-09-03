package com.getjobs.application.controller;

import org.junit.jupiter.api.Test;
import org.springframework.http.ResponseEntity;

import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;

class GlobalExceptionHandlerTest {
    @Test
    void mapsKeywordLimitValidationToBadRequest() {
        ResponseEntity<Map<String, Object>> response = new GlobalExceptionHandler()
                .handleIllegalArgument(new IllegalArgumentException("岗位关键词最多选择8个"));

        assertThat(response.getStatusCode().value()).isEqualTo(400);
        assertThat(response.getBody())
                .containsEntry("success", false)
                .containsEntry("message", "岗位关键词最多选择8个");
    }
}
