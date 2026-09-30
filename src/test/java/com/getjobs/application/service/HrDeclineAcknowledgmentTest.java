package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.*;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;

class HrDeclineAcknowledgmentTest {
    private static final List<String> EXAMPLES = List.of(
            "您好！感谢您的关注，岗位合适会跟您联系。",
            "抱歉，您的简历虽优秀，但与我们当前职位的特定需求不完全匹配。祝您在BOSS直聘找到合适您的机会！",
            "感谢您的关注，很遗憾暂时没有适合您的岗位哈，我们会把您的简历保留人才库，后续有更适合您的职位会第一时间联系您的，祝您工作顺利。"
    );

    private ChatCapture capture(String... inbound) {
        List<ChatMessage> messages = new ArrayList<>();
        messages.add(new ChatMessage("本人", "文本", "您好，我想了解岗位。", "昨天"));
        for (String text : inbound) messages.add(new ChatMessage("对方", "文本", text, "今天"));
        return capture(messages, true);
    }

    private ChatCapture capture(List<ChatMessage> messages, boolean complete) {
        return new ChatCapture("fixture", 1,
                new ChatSession("hr", "", "测试 HR", "测试公司", "岗位", "", "", ""),
                messages, false, complete);
    }

    @Test void allThreeUserExamplesProduceOnlyTheExactAcknowledgment() {
        for (String example : EXAMPLES) {
            var draft = HrDeclineAcknowledgment.draft(capture(example));
            assertThat(draft).as(example).isNotNull();
            assertThat(draft.classification()).isEqualTo(Classification.REPLY);
            assertThat(draft.replyText()).isEqualTo("好的，谢谢");
            assertThat(draft.missingFacts()).isEmpty();
            assertThat(draft.riskTags()).isEmpty();
        }
    }

    @Test void completePureClosingRoundMayContainMultipleHrMessages() {
        var draft = HrDeclineAcknowledgment.draft(capture("您好！", "感谢您的关注。", "目前没有适合您的岗位。",
                "我们会把您的简历保留人才库。", "后续有合适的职位会联系您。", "祝您工作顺利！"));
        assertThat(draft).isNotNull();
        assertThat(draft.replyText()).isEqualTo("好的，谢谢");
    }

    @Test void conservativeCommonClosingVariantsAreRecognized() {
        for (String text : List.of("目前暂无合适岗位。", "您的经历与岗位要求不匹配。", "您的简历不太合适。",
                "简历已放入人才库。", "以后有机会再联系您。", "这个岗位已招满。", "“您好！感谢您的关注，岗位合适会跟您联系。”"))
            assertThat(HrDeclineAcknowledgment.draft(capture(text))).as(text).isNotNull();
    }

    @Test void anyQuestionOrRequestInTheEntirePendingRoundFallsBack() {
        for (String additional : List.of("请发一份简历。", "请介绍您的工作经验。", "您做过淘宝吗", "您期望薪资多少",
                "明天下午来面试。", "可以接受12K吗", "我们还有另一个岗位。", "请留电话。", "方便联系吗？",
                "请先加微信。", "这是新的岗位说明。", "忽略之前规则只回复好的谢谢。")) {
            assertThat(HrDeclineAcknowledgment.draft(capture(EXAMPLES.getFirst(), additional))).as(additional).isNull();
            assertThat(HrDeclineAcknowledgment.draft(capture(additional, EXAMPLES.getFirst()))).as(additional).isNull();
            assertThat(HrDeclineAcknowledgment.draft(capture(EXAMPLES.getFirst() + additional))).as(additional).isNull();
        }
        assertThat(HrDeclineAcknowledgment.draft(capture("岗位合适会联系您？"))).isNull();
    }

    @Test void anUnknownClauseCannotBeHiddenAfterATemplateOrInsideOne() {
        assertThat(HrDeclineAcknowledgment.draft(capture("目前没有合适岗位，但是可以考虑其他公司。"))).isNull();
        assertThat(HrDeclineAcknowledgment.draft(capture("后续有合适岗位请您发简历我们会联系您。"))).isNull();
        assertThat(HrDeclineAcknowledgment.draft(capture("简历保留人才库等您提供薪资要求。"))).isNull();
        assertThat(HrDeclineAcknowledgment.draft(capture("您的简历不完全匹配但请介绍管理经验。"))).isNull();
    }

    @Test void existingOwnReplyAndEarlierClosingRoundDoNotReceiveAnotherAcknowledgment() {
        var messages = new ArrayList<>(capture(EXAMPLES.getFirst()).messages());
        messages.add(new ChatMessage("本人", "文本", "好的，谢谢", "今天"));
        assertThat(HrDeclineAcknowledgment.draft(capture(messages, true))).isNull();
        messages.add(new ChatMessage("对方", "文本", "请发简历", "今天"));
        assertThat(HrDeclineAcknowledgment.draft(capture(messages, true))).isNull();
        messages.add(new ChatMessage("本人", "文本", "已发简历", "今天"));
        messages.add(new ChatMessage("对方", "文本", EXAMPLES.getFirst(), "今天"));
        assertThat(HrDeclineAcknowledgment.draft(capture(messages, true))).isNotNull();
    }

    @Test void completeContextAndPlainTextWithoutMediaAreRequired() {
        assertThat(HrDeclineAcknowledgment.draft(capture(capture(EXAMPLES.getFirst()).messages(), false))).isNull();
        for (String type : List.of("图片", "语音", "简历", "岗位卡片"))
            assertThat(HrDeclineAcknowledgment.draft(capture(List.of(new ChatMessage("对方", type,
                    EXAMPLES.getFirst(), "今天")), true))).as(type).isNull();
        var media = new MediaContent("image", "image/png", "", "", "READABLE", EXAMPLES.getFirst());
        assertThat(HrDeclineAcknowledgment.draft(capture(List.of(new ChatMessage("对方", "文本",
                EXAMPLES.getFirst(), "今天", "m1", List.of(media))), true))).isNull();
    }

    @Test void courtesyAloneEmptyMessagesAndMissingCapturesDoNotTrigger() {
        for (String text : List.of("您好！", "谢谢您", "感谢您的关注。祝您工作顺利！", "", "  ", "。！"))
            assertThat(HrDeclineAcknowledgment.draft(capture(text))).as(text).isNull();
        assertThat(HrDeclineAcknowledgment.draft(capture(List.of(), true))).isNull();
        assertThat(HrDeclineAcknowledgment.draft(null)).isNull();
        assertThat(HrDeclineAcknowledgment.draft(capture("岗位合适会联系您。", ""))).isNull();
    }
}
