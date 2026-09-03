package com.getjobs.application.service;

import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class JobKeywordCodecTest {
    @Test
    void parsesLegacyAndJsonFormatsWithCaseInsensitiveDedupe() {
        assertThat(JobKeywordCodec.parse("Java，AI产品经理；java\nRAG产品"))
                .containsExactly("Java", "AI产品经理", "RAG产品");
        assertThat(JobKeywordCodec.parse("[\"Java\",\"AI产品经理\",\"JAVA\"]"))
                .containsExactly("Java", "AI产品经理");
    }

    @Test
    void serializesCanonicalJsonAndRejectsMoreThanEight() {
        assertThat(JobKeywordCodec.validateAndSerialize("Java，AI产品经理，Java"))
                .isEqualTo("[\"Java\",\"AI产品经理\"]");
        assertThatThrownBy(() -> JobKeywordCodec.parseAndValidate(
                "岗位1,岗位2,岗位3,岗位4,岗位5,岗位6,岗位7,岗位8,岗位9"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("最多选择8个");
    }

    @Test
    void normalizeCanLimitAiRecommendationsWithoutChangingOrder() {
        assertThat(JobKeywordCodec.normalize(List.of(
                "岗位1", "岗位2", "岗位3", "岗位4", "岗位5", "岗位6", "岗位7", "岗位8", "岗位9"), 8))
                .containsExactly("岗位1", "岗位2", "岗位3", "岗位4", "岗位5", "岗位6", "岗位7", "岗位8");
    }
}
