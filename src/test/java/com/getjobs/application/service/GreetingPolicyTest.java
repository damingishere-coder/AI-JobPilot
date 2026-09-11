package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class GreetingPolicyTest {
    private static final String URL = "https://toudiniuma.cn/";
    private final GreetingPolicy policy = new GreetingPolicy(URL, 4L);

    @Test
    void totalIncludesWebsiteSpacesAndPunctuationWithExactBoundary() {
        String hundred = "我".repeat(100 - URL.length() - 2) + "， " + URL;
        assertThat(policy.isValid(hundred, 4L)).isTrue();
        assertThat(policy.isValid(hundred + "。", 4L)).isFalse();
        assertThatThrownBy(() -> policy.validateDraft(hundred + "。", 4L))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(policy.prepare(hundred, 4L)).isEqualTo(hundred);
    }

    @Test
    void countsSupplementaryCharactersAsOneWithoutDiscardingSpaces() {
        String text = "😀".repeat(100 - URL.length() - 2) + "， " + URL;
        assertThat(GreetingPolicy.count(text)).isEqualTo(100);
        assertThat(policy.isValid(text, 4L)).isTrue();
        assertThat(policy.isValid(text + " ", 4L)).isFalse();
    }

    @Test
    void addsWebsiteToHistoricalGreetingWithoutAnotherAiCall() {
        String original = "您好，岗位需要AI应用落地，我有AI工作流开发经验，期待交流。";
        String result = policy.prepare(original, 4L);
        assertThat(result).startsWith(original).endsWith(URL);
        assertThat(policy.isValid(result, 4L)).isTrue();
        assertThat(policy.prepare(result, 4L)).isEqualTo(result);
    }

    @Test
    void longAndDuplicateWebsiteTextAlwaysProducesOneCompleteUrl() {
        for (String text : new String[]{"长".repeat(200),
                "您好，岗位需要AI应用落地。" + "我有相关的真实实践。".repeat(20),
                "您好，个人作品集：" + URL + "，作品集：" + URL}) {
            String result = policy.prepare(text, 4L);
            assertThat(policy.isValid(result, 4L)).as(result).isTrue();
            assertThat(result).endsWith(URL);
        }
    }

    @Test
    void manualDraftMustAlreadyFitAndIncludeWebsite() {
        assertThatThrownBy(() -> policy.validateDraft("您好，期待沟通。", 4L))
                .hasMessageContaining("完整作品集网址");
        assertThat(policy.prepare("", 4L)).isEmpty();
    }

    @Test
    void personalWebsiteDoesNotLeakIntoOtherProfiles() {
        assertThat(policy.prepare("您好，期待沟通。", 5L)).isEqualTo("您好，期待沟通。");
        assertThat(policy.instruction(5L)).doesNotContain(URL);
        assertThat(policy.instruction(4L)).contains(URL, "100", "空格", "岗位JD");
        assertThatThrownBy(() -> new GreetingPolicy(URL, 0L)).isInstanceOf(IllegalArgumentException.class);
    }
}
