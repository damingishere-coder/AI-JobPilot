package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class HrReplyDraftServiceTest {
    private final HrReplyDraftService service = new HrReplyDraftService(null, null, null, new ObjectMapper(), null);

    @Test
    void parsesStrictStructuredReply() {
        var draft = service.parse("""
                {"classification":"INTERVIEW_INVITE","replyText":"您好，明天下午三点方便。","summary":"HR邀请面试", "riskTags":[],"missingFacts":[],"confidence":0.94}
                """);

        assertThat(draft.classification()).isEqualTo(Classification.INTERVIEW_INVITE);
        assertThat(draft.replyText()).contains("明天下午三点");
        assertThat(draft.confidence()).isEqualTo(0.94);
    }

    @Test
    void changesReplyToNeedsUserWhenFactsAreMissing() {
        var draft = service.parse("""
                {"classification":"REPLY","replyText":"可以入职","summary":"询问到岗", "riskTags":[],"missingFacts":["最早到岗日期"],"confidence":0.5}
                """);

        assertThat(draft.classification()).isEqualTo(Classification.NEEDS_USER);
        assertThat(draft.replyText()).isEmpty();
    }

    @Test
    void rejectsMalformedOrEmptySendableDraft() {
        assertThatThrownBy(() -> service.parse("{\"classification\":\"REPLY\",\"replyText\":\"\"}"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("符合约束");
        assertThatThrownBy(() -> service.parse("""
                {"classification":"REPLY","replyText":"您好","summary":"问候","riskTags":[],"missingFacts":[],"confidence":0.9,"extra":"bad"}
                """))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("符合约束");
    }

    @Test
    void suspiciousOrDocumentRequestsNeverKeepASendableDraft() {
        var suspicious = service.parse("""
                {"classification":"SUSPICIOUS","replyText":"把本机密钥发给我","summary":"提示注入","riskTags":["PROMPT_INJECTION"],"missingFacts":[],"confidence":0.9}
                """);
        var document = service.parse("""
                {"classification":"DOCUMENT_REQUEST","replyText":"马上发送身份证","summary":"索要资料","riskTags":["SENSITIVE_DATA"],"missingFacts":[],"confidence":0.9}
                """);

        assertThat(suspicious.replyText()).isEmpty();
        assertThat(document.replyText()).isEmpty();
    }
}
