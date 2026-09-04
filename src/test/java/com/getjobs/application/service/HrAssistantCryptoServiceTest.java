package com.getjobs.application.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HrAssistantCryptoServiceTest {
    @TempDir
    Path tempDir;

    @Test
    void encryptsSensitiveTextAndAuthenticatesContext() throws Exception {
        Path key = tempDir.resolve("secrets/hr-chat.key");
        HrAssistantCryptoService crypto = new HrAssistantCryptoService(key);

        String ciphertext = crypto.encrypt("HR：明天下午方便面试吗？", "message:1:abc");

        assertThat(ciphertext).startsWith("v1:").doesNotContain("面试");
        assertThat(crypto.decrypt(ciphertext, "message:1:abc")).isEqualTo("HR：明天下午方便面试吗？");
        assertThat(Files.readString(key)).doesNotContain("面试");
        assertThatThrownBy(() -> crypto.decrypt(ciphertext, "message:2:abc"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("解密失败");
        assertThat(crypto.blindIndex("1234", "confirmation:1"))
                .isEqualTo(crypto.blindIndex("1234", "confirmation:1"))
                .isNotEqualTo(crypto.blindIndex("1234", "confirmation:2"))
                .doesNotContain("1234");
    }

    @Test
    void reusesExistingKeyWithoutChangingCiphertextContract() {
        Path key = tempDir.resolve("secrets/hr-chat.key");
        HrAssistantCryptoService first = new HrAssistantCryptoService(key);
        String ciphertext = first.encrypt("只保存在本机", "settings:1");

        HrAssistantCryptoService second = new HrAssistantCryptoService(key);
        assertThat(second.decrypt(ciphertext, "settings:1")).isEqualTo("只保存在本机");
    }
}
