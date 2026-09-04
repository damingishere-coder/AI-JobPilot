package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.UnreadConversation;
import org.junit.jupiter.api.Test;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class OpenCliBossGatewayTest {
    @Test
    void parsesOnlyRowsWithNumericRedBadgeFromDomSnapshot() {
        FakeRunner runner = new FakeRunner();
        runner.evalOutput = """
                {"totalUnread":16,"rows":[
                  {"domIndex":0,"unreadCount":1,"hrName":"胡女士","companyName":"深圳公司","jobName":"","lastMessage":"收到您的简历","lastTime":"11:02"},
                  {"domIndex":1,"unreadCount":0,"hrName":"刘先生","companyName":"兴趣岛","jobName":"","lastMessage":"好的谢谢","lastTime":"11:01"}
                ]}
                """;
        OpenCliBossGateway gateway = gateway(runner);

        var snapshot = gateway.readUnreadSnapshot();

        assertThat(snapshot.totalUnread()).isEqualTo(16);
        assertThat(snapshot.conversations()).singleElement().satisfies(row -> {
            assertThat(row.unreadCount()).isEqualTo(1);
            assertThat(row.hrName()).isEqualTo("胡女士");
        });
    }

    @Test
    void refusesAmbiguousVisibleIdentityMapping() {
        OpenCliBossGateway gateway = gateway(new FakeRunner());
        UnreadConversation row = new UnreadConversation(0, 1, "张先生", "同名公司", "", "你好", "10:00");
        List<ChatSession> duplicates = List.of(
                new ChatSession("u1", "s1", "张先生", "同名公司", "产品", "HR", "你好", "10:00"),
                new ChatSession("u2", "s2", "张先生", "同名公司", "运营", "HR", "你好", "10:00"));

        assertThatThrownBy(() -> gateway.matchUnique(row, duplicates))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("不唯一");
    }

    @Test
    void sendsThroughSelectorFillAndEnterInsteadOfRecruiterAdapter() {
        FakeRunner runner = new FakeRunner();
        OpenCliBossGateway gateway = gateway(runner);

        gateway.fillAndSend("您好，我明天下午三点方便面试。");

        assertThat(runner.calls).containsExactly(
                List.of("browser", "boss-hr", "state"),
                List.of("browser", "boss-hr", "fill", "#chat-input", "您好，我明天下午三点方便面试。"),
                List.of("browser", "boss-hr", "focus", "#chat-input"),
                List.of("browser", "boss-hr", "keys", "Enter"));
        assertThat(runner.calls.stream().flatMap(List::stream)).doesNotContain("send");
    }

    private OpenCliBossGateway gateway(OpenCliCommandRunner runner) {
        return new OpenCliBossGateway(runner, new ObjectMapper(), "boss-hr", 30);
    }

    private static final class FakeRunner implements OpenCliCommandRunner {
        private final List<List<String>> calls = new ArrayList<>();
        private String evalOutput = "{\"totalUnread\":0,\"rows\":[]}";

        @Override
        public CommandResult run(List<String> arguments, Duration timeout) {
            calls.add(List.copyOf(arguments));
            if (arguments.contains("eval")) return new CommandResult(0, evalOutput, "", false);
            if (arguments.contains("fill")) return new CommandResult(0,
                    "{\"filled\":true,\"verified\":true,\"matches_n\":1,\"match_level\":\"exact\"}", "", false);
            if (arguments.contains("focus")) return new CommandResult(0,
                    "{\"focused\":true,\"matches_n\":1,\"match_level\":\"exact\"}", "", false);
            if (arguments.contains("keys")) return new CommandResult(0, "Pressed: Enter", "", false);
            return new CommandResult(0, "{}", "", false);
        }
    }
}
