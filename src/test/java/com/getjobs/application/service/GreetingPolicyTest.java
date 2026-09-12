package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.*;

class GreetingPolicyTest {
    private static final String URL = "https://toudiniuma.cn/";
    private final GreetingPolicy policy = new GreetingPolicy(URL, 4L);

    @Test
    void bodyLimitExcludesOnlyTheTrailingPortfolioRecommendation() {
        String suffix = policy.portfolioSuffix(4L);
        String exact = "我".repeat(150) + "\n" + suffix;
        assertThat(policy.isValid(exact, 4L)).isTrue();
        assertThat(policy.prepare(exact, 4L)).isEqualTo(exact);
        assertThat(policy.isValid("我" + exact, 4L)).isFalse();
        assertThatThrownBy(() -> policy.validateDraft("我" + exact, 4L)).hasMessageContaining("150");
        assertThat(policy.isValid(exact + "其他正文", 4L)).isFalse();
        assertThat(policy.isValid("\n" + suffix, 4L)).isFalse();
        assertThat(policy.isValid(exact, 5L)).isFalse();
        assertThat(policy.isValid(exact + URL, 4L)).isFalse();
        assertThat(policy.prepare("我".repeat(150), 4L)).isEqualTo(exact);
    }

    @Test
    void countsSupplementaryCharactersAndInternalSpacesInBody() {
        String body = "😀".repeat(148) + "， ";
        String text = body + "内容\n" + policy.portfolioSuffix(4L);
        assertThat(GreetingPolicy.count(body)).isEqualTo(150);
        assertThat(policy.isValid(text, 4L)).isFalse();
        assertThat(policy.isValid("😀".repeat(148) + " ，\n" + policy.portfolioSuffix(4L), 4L)).isTrue();
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
        assertThat(policy.instruction(4L)).contains(URL, "150", "空格", "岗位JD", "最有分量", "交流入口", "不生成作品推荐语");
        assertThatThrownBy(() -> new GreetingPolicy(URL, 0L)).isInstanceOf(IllegalArgumentException.class);
    }
}
