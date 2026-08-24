package com.getjobs.application.service;

/**
 * 不携带 Provider 原始响应的安全异常；可直接用于任务错误信息和本机 API 提示。
 */
public class AiProviderException extends RuntimeException {
    private final Code code;
    private final Integer httpStatus;
    private final String clientRequestId;
    private final String providerRequestId;
    private final boolean outcomeUnknown;

    public AiProviderException(Code code,
                               String message,
                               Integer httpStatus,
                               String clientRequestId,
                               String providerRequestId,
                               boolean outcomeUnknown,
                               Throwable cause) {
        super(message, cause);
        this.code = code;
        this.httpStatus = httpStatus;
        this.clientRequestId = clientRequestId;
        this.providerRequestId = providerRequestId;
        this.outcomeUnknown = outcomeUnknown;
    }

    public Code getCode() {
        return code;
    }

    public Integer getHttpStatus() {
        return httpStatus;
    }

    public String getClientRequestId() {
        return clientRequestId;
    }

    public String getProviderRequestId() {
        return providerRequestId;
    }

    public boolean isOutcomeUnknown() {
        return outcomeUnknown;
    }

    public enum Code {
        RATE_LIMITED,
        HTTP_4XX,
        HTTP_5XX,
        TIMEOUT,
        NETWORK,
        EMPTY_RESPONSE,
        INVALID_RESPONSE
    }
}
