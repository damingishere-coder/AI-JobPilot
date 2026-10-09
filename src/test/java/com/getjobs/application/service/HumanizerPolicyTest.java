package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HexFormat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HumanizerPolicyTest {
    @Test
    void packagedSkillMatchesThePinnedUpstreamAndDoesNotInjectExampleFacts() throws Exception {
        try (var stream = HumanizerPolicy.class.getResourceAsStream("/humanizer/SKILL.md")) {
            assertThat(stream).isNotNull();
            String source = new String(stream.readAllBytes(), StandardCharsets.UTF_8).replace("\r\n", "\n");
            String digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                    .digest(source.getBytes(StandardCharsets.UTF_8)));
            assertThat(digest).isEqualTo("0612f1dfb1672b0ea9b97e139bf1f06cabe98d8b27424fe8ff01e1fb4cc99cad");
        }
        String prompt = HumanizerPolicy.instructions("replyText");
        assertThat(prompt.lines().filter(line -> line.startsWith("### ")).count()).isEqualTo(26);
        assertThat(prompt.length()).isLessThan(15_500);
        assertThat(prompt).doesNotContain("Somali cuisine", "Catalonia was officially", "500,000 followers",
                "**Pasted text (default).**", "**Before:**", "**After:**");
        try (var license = HumanizerPolicy.class.getResourceAsStream("/humanizer/LICENSE")) {
            assertThat(license).isNotNull();
            assertThat(new String(license.readAllBytes(), StandardCharsets.UTF_8))
                    .contains("MIT License", "Copyright (c) 2025 Siqi Chen");
        }
    }

    @Test
    void embeddedEditingPreservesBusinessFactsAndOnlyReturnsTheFinalStructuredText() {
        for (String field : new String[]{"replyText", "greeting"}) {
            assertThat(HumanizerPolicy.instructions(field)).contains(field, "不改变信息", "15–20K",
                    "联系方式", "URL", "否定", "条件", "承诺", "无需回复时保持正文为空",
                    "婉拒回复保持“好的，谢谢”", "分类、风险、缺失资料", "原业务 Schema 的最终 JSON");
        }
        assertThatThrownBy(() -> HumanizerPolicy.instructions("classification"))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
