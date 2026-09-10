package com.getjobs.application.controller;

import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.server.ResponseStatusException;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;

@RestControllerAdvice
@Slf4j
public class GlobalExceptionHandler {

    @ExceptionHandler(MaxUploadSizeExceededException.class)
    public ResponseEntity<Map<String, Object>> handleMaxUploadSize(MaxUploadSizeExceededException e) {
        String requestId = requestId();
        log.warn("requestId={} upload rejected: MaxUploadSizeExceededException", requestId);
        return ResponseEntity.badRequest().body(failure("UPLOAD_TOO_LARGE", "文件过大，请压缩到30MB以内后再上传", requestId));
    }

    @ExceptionHandler(com.getjobs.application.service.HrProfileGuard.WatchActiveException.class)
    public ResponseEntity<Map<String, Object>> handleWatchActive(com.getjobs.application.service.HrProfileGuard.WatchActiveException e) {
        return ResponseEntity.status(409).body(failure("HR_WATCH_ACTIVE", e.getMessage(), requestId()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalState(IllegalStateException e) {
        String requestId = requestId();
        log.warn("requestId={} request state rejected: IllegalStateException", requestId);
        return ResponseEntity.badRequest().body(failure("INVALID_STATE", safeMessage(e), requestId));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, Object>> handleIllegalArgument(IllegalArgumentException e) {
        String requestId = requestId();
        log.warn("requestId={} request rejected: IllegalArgumentException", requestId);
        return ResponseEntity.badRequest().body(failure("INVALID_REQUEST", safeMessage(e), requestId));
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<Map<String, Object>> handleHttpMessageNotReadable(HttpMessageNotReadableException e) {
        String requestId = requestId();
        log.warn("requestId={} request body rejected: HttpMessageNotReadableException", requestId);
        return ResponseEntity.badRequest().body(failure("INVALID_JSON", "请求参数格式不正确，请检查 JSON 字段和值类型", requestId));
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<Map<String, Object>> handleResponseStatus(ResponseStatusException error) {
        if (error.getStatusCode().is5xxServerError()) {
            return ResponseEntity.status(error.getStatusCode())
                    .body(failure("INTERNAL_ERROR", "本地服务处理失败，请根据错误编号检查日志", requestId()));
        }
        String reason = error.getReason();
        return ResponseEntity.status(error.getStatusCode())
                .body(failure("REQUEST_REJECTED", reason == null || reason.isBlank() ? "请求无法处理" : reason, requestId()));
    }

    @ExceptionHandler(Throwable.class)
    public ResponseEntity<Map<String, Object>> handleUnknown(Throwable error) {
        String requestId = requestId();
        log.error("requestId={} unhandled request failure type={}", requestId, error.getClass().getSimpleName());
        return ResponseEntity.internalServerError()
                .body(failure("INTERNAL_ERROR", "本地服务处理失败，请根据错误编号检查日志", requestId));
    }

    private Map<String, Object> failure(String errorCode, String message, String requestId) {
        Map<String, Object> response = new LinkedHashMap<>();
        response.put("success", false);
        response.put("errorCode", errorCode);
        response.put("message", message);
        response.put("requestId", requestId);
        return response;
    }

    private String safeMessage(Throwable error) {
        return error.getMessage() == null || error.getMessage().isBlank() ? "请求处理失败" : error.getMessage();
    }

    private String requestId() {
        return UUID.randomUUID().toString();
    }
}
