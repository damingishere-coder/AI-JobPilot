package com.getjobs.application.service;

import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;

/**
 * 为本机前端签发进程级操作令牌。令牌只保存在内存中，后端重启后自动失效。
 */
@Service
public class LocalActionTokenService {
    public static final String HEADER_NAME = "X-Local-Action-Token";

    private final String token = createToken();

    public String issueToken() {
        return token;
    }

    public boolean isValid(String candidate) {
        if (candidate == null || candidate.isBlank()) return false;
        return MessageDigest.isEqual(
                token.getBytes(StandardCharsets.UTF_8),
                candidate.trim().getBytes(StandardCharsets.UTF_8));
    }

    private String createToken() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }
}
