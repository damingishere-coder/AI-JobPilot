package com.getjobs.application.service;

import com.getjobs.application.mapper.AiMapper;
import org.junit.jupiter.api.Test;

import java.util.List;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.spy;

class AiServiceResumeKeywordTest {
    @Test
    @SuppressWarnings("unchecked")
    void parsesAndLimitsRecommendedKeywordsFromTheSameAiCall() {
        AiService service = spy(new AiService(
                mock(ConfigService.class),
                mock(AiMapper.class),
                mock(ProfileService.class),
                mock(CodexCliService.class)
        ));
        doReturn("""
                {"introduce":"熟悉AI产品落地","prompt":"%s %s %s %s %s","sayHi":"你好，希望进一步沟通",\
                "recommendedKeywords":["AI产品经理","大模型产品经理","ai产品经理","RAG产品","智能体产品","AI运营","产品运营","AI解决方案","AIGC产品"]}
                """).when(service).sendRequest(anyString());

        Map<String, Object> generated = service.generateResumeAiConfig("候选人有五年AI产品经验");

        assertThat(generated).containsKeys("introduce", "prompt", "sayHi", "recommendedKeywords");
        assertThat((List<String>) generated.get("recommendedKeywords"))
                .containsExactly("AI产品经理", "大模型产品经理", "RAG产品", "智能体产品", "AI运营", "产品运营", "AI解决方案", "AIGC产品");
    }
}
