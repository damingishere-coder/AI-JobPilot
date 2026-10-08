package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.*;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class HrConversationPolicyTest {
    private ChatCapture capture(ChatMessage... messages) {
        return new ChatCapture("test", 1, new ChatSession("uid", "", "HR", "公司", "岗位", "", "", "今天"),
                List.of(messages), false, true);
    }

    private ChatMessage self(String text) { return new ChatMessage("本人", "文本", text, "今天"); }
    private ChatMessage hr(String text) { return new ChatMessage("对方", "文本", text, "今天"); }

    @Test void greetingAllowsNaturalCourtesyButNotAnUnsolicitedJobInterview() {
        var c = capture(self("你好"), hr("你好，在吗？"));
        assertThat(HrConversationPolicy.violation(c, "你好，我在。")).isEmpty();
        assertThat(HrConversationPolicy.violation(c, "你好，想了解这个岗位主要做什么？"))
                .contains("简单招呼");
        assertThat(HrConversationPolicy.violation(c, "你好，我有十年管理经验。"))
                .contains("简单招呼");
        assertThat(HrConversationPolicy.violation(capture(hr("方便聊聊吗？")), "可以，你说。")).isEmpty();
    }

    @Test void repeatedQuestionIsBlockedEvenWhenItsPolitePrefixChanges() {
        var c = capture(self("你好，请问工作地点在哪里？"), hr("还在沟通中"));
        assertThat(HrConversationPolicy.violation(c, "想了解工作地点在哪里？")).contains("已经问过");
        assertThat(HrConversationPolicy.violation(c, "想了解岗位职责是什么？")).isEmpty();
        var different = capture(self("岗位职责是什么，方便介绍一下吗？"), hr("主要做内容运营"));
        assertThat(HrConversationPolicy.violation(different, "工作地点在哪里，方便介绍一下吗？")).isEmpty();
    }

    @Test void twoAdditionalQuestionsAreBlockedButAnsweringMultipleQuestionsIsAllowed() {
        var c = capture(hr("有兴趣了解这个岗位吗？"));
        assertThat(HrConversationPolicy.violation(c, "请问岗位职责是什么？工作地点在哪里？"))
                .contains("多个追问");
        assertThat(HrConversationPolicy.violation(c, "有三年运营经验，期望15–20K。")).isEmpty();
    }

    @Test void noNewHrMessageCannotTriggerAFollowup() {
        assertThat(HrConversationPolicy.violation(capture(hr("你好"), self("你好，我在。")), "还在吗？"))
                .contains("没有新的待回复消息");
    }

    @Test void entireClosingRoundIsQuietButAQuestionFollowedByThanksStillNeedsAnAnswer() {
        assertThat(HrConversationPolicy.closingRound(capture(self("三年运营经验"), hr("好的"), hr("谢谢你")))).isTrue();
        assertThat(HrConversationPolicy.closingRound(capture(self("你好"), hr("做过淘宝吗？"), hr("谢谢")))).isFalse();
        assertThat(HrConversationPolicy.closingRound(capture(hr("谢谢")))).isFalse();
    }

    @Test void mediaAndIncompleteReadsCannotBeMistakenForClosingCourtesy() {
        var base = capture(self("你好"), hr("谢谢"));
        var incomplete = new ChatCapture(base.captureId(), 1, base.session(), base.messages(), false, false);
        assertThat(HrConversationPolicy.closingRound(incomplete)).isFalse();
        var image = new ChatMessage("对方", "图片", "谢谢", "今天", "m2",
                List.of(new MediaContent("问题.png", "image/png", "", "", "READABLE", "到岗时间？")));
        assertThat(HrConversationPolicy.closingRound(capture(self("你好"), image))).isFalse();
    }

    @Test void declineAllowsOnlyTheExistingAcknowledgment() {
        var c = capture(self("你好"), hr("不好意思，不太合适哦"));
        assertThat(HrConversationPolicy.violation(c, "好的，谢谢")).isEmpty();
        assertThat(HrConversationPolicy.violation(c, "好的，谢谢。我还有其他相关经验，能再考虑吗？"))
                .contains("只能礼貌致谢");
    }

    @Test void courtesyExemptionsCannotAuthorizeExperienceOrCommitments() {
        for (String text : List.of("我在", "我在的", "谢谢你", "可以", "你说"))
            assertThat(HrConversationPolicy.courtesy(text)).as(text).isTrue();
        for (String text : List.of("我在职", "我在华为", "我有十年经理经验", "可以明天入职", "我接受Offer"))
            assertThat(HrConversationPolicy.courtesy(text)).as(text).isFalse();
        assertThat(HrConversationPolicy.jobQuestion("想了解下这个岗位主要做什么？")).isTrue();
        assertThat(HrConversationPolicy.jobQuestion("请问我有十年经理经验岗位职责？")).isFalse();
    }
}
