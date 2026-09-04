package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.GatewayStatus;
import com.getjobs.application.hr.HrAssistantTypes.UnreadConversation;
import com.getjobs.application.hr.HrAssistantTypes.UnreadSnapshot;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.Objects;

@Slf4j
@Service
public class OpenCliBossGateway {
    private static final String CHAT_ROW_SELECTOR = "li[role='listitem'], .chat-list li, [class*='chat-list'] li";
    static final String READ_CHAT_ROWS_SCRIPT = """
            (() => {
              const clean = (v) => String(v || '').replace(/\\s+/g, ' ').trim();
              const red = (el) => {
                const className = clean(el.className).toLowerCase();
                if (className.includes('unread') || className.includes('badge')) return true;
                const nums = (getComputedStyle(el).backgroundColor || '').match(/\\d+/g) || [];
                return nums.length >= 3 && Number(nums[0]) > 170 && Number(nums[1]) < 150 && Number(nums[2]) < 150;
              };
              const unreadTab = [...document.querySelectorAll('button,span,div')]
                .map(el => clean(el.textContent)).find(text => /^未读\\(\\d+\\)$/.test(text)) || '';
              const totalUnread = Number((unreadTab.match(/\\d+/) || ['0'])[0]);
              const rows = [...document.querySelectorAll("li[role='listitem'], .chat-list li, [class*='chat-list'] li")].map((row, domIndex) => {
                const badge = [...row.querySelectorAll('span,div,i,b')]
                  .find(el => /^\\d+$/.test(clean(el.textContent)) && red(el));
                const titleBox = row.querySelector('.title-box');
                const nameBox = row.querySelector('.name-box');
                const last = row.querySelector('.last-msg-text,.last-msg,[class*="last-msg"]');
                const time = row.querySelector('time,.time,[class*="time"]');
                const spans = titleBox ? [...titleBox.querySelectorAll('span')].map(el => clean(el.textContent)).filter(Boolean) : [];
                return {
                  domIndex,
                  unreadCount: badge ? Number(clean(badge.textContent)) : 0,
                  hrName: spans[0] || clean(nameBox && nameBox.textContent),
                  companyName: spans[1] || '',
                  jobName: '',
                  lastMessage: clean(last && last.textContent),
                  lastTime: clean(time && time.textContent)
                };
              });
              return { totalUnread, rows };
            })()
            """;
    static final String SCROLL_CHAT_LIST_SCRIPT = """
            (() => {
              const rows = [...document.querySelectorAll("li[role='listitem'], .chat-list li, [class*='chat-list'] li")];
              let scroller = rows[0]?.parentElement || null;
              while (scroller && scroller !== document.body) {
                if (scroller.scrollHeight > scroller.clientHeight + 2) break;
                scroller = scroller.parentElement;
              }
              if (!scroller || scroller === document.body) {
                return { scrolled: false, reason: 'scroll-container-not-found' };
              }
              const before = scroller.scrollTop;
              const amount = Math.max(400, Math.floor(scroller.clientHeight * 0.8));
              scroller.scrollTop = Math.min(scroller.scrollHeight, before + amount);
              scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
              return {
                scrolled: scroller.scrollTop > before,
                before,
                after: scroller.scrollTop,
                atEnd: scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2
              };
            })()
            """;

    private final OpenCliCommandRunner commandRunner;
    private final ObjectMapper objectMapper;
    private final String sessionName;
    private final Duration timeout;
    private volatile GatewayStatus cachedStatus;
    private volatile Instant cachedStatusAt = Instant.EPOCH;

    public OpenCliBossGateway(OpenCliCommandRunner commandRunner,
                              ObjectMapper objectMapper,
                              @Value("${app.hr-assistant.opencli-session:boss-hr}") String sessionName,
                              @Value("${app.hr-assistant.command-timeout-seconds:30}") long timeoutSeconds) {
        this.commandRunner = commandRunner;
        this.objectMapper = objectMapper;
        this.sessionName = sessionName == null || sessionName.isBlank() ? "boss-hr" : sessionName.trim();
        this.timeout = Duration.ofSeconds(Math.max(5, Math.min(timeoutSeconds, 120)));
    }

    public GatewayStatus status() {
        GatewayStatus cached = cachedStatus;
        if (cached != null && cachedStatusAt.plusSeconds(30).isAfter(Instant.now())) return cached;
        var version = commandRunner.run(List.of("--version"), Duration.ofSeconds(10));
        if (!version.success()) return cacheStatus(new GatewayStatus(false, "", conciseFailure(version)));
        var doctor = commandRunner.run(List.of("doctor"), timeout);
        return cacheStatus(new GatewayStatus(doctor.success(), version.stdout(), doctor.success() ? "OpenCLI Browser Bridge 已连接" : conciseFailure(doctor)));
    }

    public void bindCurrentChatTab() {
        requireSuccess(commandRunner.run(List.of("browser", sessionName, "bind"), timeout), "绑定当前 Chrome 标签页");
        String url = requireSuccess(commandRunner.run(List.of("browser", sessionName, "get", "url"), timeout), "读取当前标签页地址");
        if (!url.contains("zhipin.com/web/geek/chat")) {
            throw new IllegalStateException("当前标签页不是 BOSS 求职者聊天页，请先打开聊天页再开始值守");
        }
    }

    public void prepareCurrentChatTabBinding() {
        requireSuccess(commandRunner.run(List.of("browser", sessionName, "unbind"), timeout), "释放旧 OpenCLI 浏览器会话");
    }

    public void openUnreadTab() {
        requireSuccess(commandRunner.run(List.of("browser", sessionName, "state"), timeout), "检查 BOSS 页面状态");
        var result = commandRunner.run(List.of("browser", sessionName, "click", "--text", "未读("), timeout);
        if (!result.success()) {
            result = commandRunner.run(List.of("browser", sessionName, "click", "--text", "未读"), timeout);
        }
        requireSuccess(result, "切换 BOSS 未读选项卡");
        requireExactWriteEnvelope(result.stdout(), "clicked");
    }

    public UnreadSnapshot readUnreadSnapshot() {
        JsonNode root = parseJson(requireSuccess(commandRunner.run(
                List.of("browser", sessionName, "eval", READ_CHAT_ROWS_SCRIPT), timeout), "读取未读红点"));
        int total = root.path("totalUnread").asInt(0);
        List<UnreadConversation> rows = new ArrayList<>();
        for (JsonNode node : root.path("rows")) {
            int unread = node.path("unreadCount").asInt(0);
            if (unread <= 0) continue;
            rows.add(toUnreadConversation(node));
        }
        return new UnreadSnapshot(total, rows);
    }

    public boolean scrollUnreadList() {
        JsonNode result = parseJson(requireSuccess(commandRunner.run(
                List.of("browser", sessionName, "eval", SCROLL_CHAT_LIST_SCRIPT), timeout), "滚动 BOSS 未读会话列表"));
        if (!result.path("scrolled").asBoolean(false)) return false;
        requireSuccess(commandRunner.run(List.of("browser", sessionName, "wait", "time", "1"), timeout),
                "等待 BOSS 未读会话加载");
        return true;
    }

    public List<ChatSession> listChats(int limit) {
        String output = requireSuccess(commandRunner.run(List.of(
                "boss", "chatlist", "--side", "geek", "--page", "1", "--limit", Integer.toString(Math.min(100, Math.max(1, limit))), "-f", "json"), timeout),
                "读取 BOSS 会话列表");
        JsonNode root = parseJson(output);
        List<ChatSession> result = new ArrayList<>();
        if (!root.isArray()) throw new IllegalStateException("OpenCLI chatlist 返回结构异常");
        for (JsonNode node : root) {
            result.add(new ChatSession(
                    text(node, "uid"), text(node, "security_id"), text(node, "name"), text(node, "company"),
                    text(node, "job"), text(node, "title"), text(node, "last_msg"), text(node, "last_time")));
        }
        return List.copyOf(result);
    }

    public List<ChatMessage> readMessages(String uid) {
        requireNonBlank(uid, "会话 UID");
        String output = requireSuccess(commandRunner.run(List.of(
                "boss", "chatmsg", uid, "--side", "geek", "--page", "1", "-f", "json"), timeout),
                "读取 BOSS 聊天记录");
        JsonNode root = parseJson(output);
        if (!root.isArray()) throw new IllegalStateException("OpenCLI chatmsg 返回结构异常");
        List<ChatMessage> result = new ArrayList<>();
        for (JsonNode node : root) {
            result.add(new ChatMessage(text(node, "from"), text(node, "type"), text(node, "text"), text(node, "time")));
        }
        return List.copyOf(result);
    }

    public void openConversation(UnreadConversation target) {
        Objects.requireNonNull(target, "target");
        JsonNode root = parseJson(requireSuccess(commandRunner.run(
                List.of("browser", sessionName, "eval", READ_CHAT_ROWS_SCRIPT), timeout), "刷新 BOSS 会话列表"));
        List<UnreadConversation> rows = new ArrayList<>();
        for (JsonNode node : root.path("rows")) rows.add(toUnreadConversation(node));
        List<UnreadConversation> matches = rows.stream().filter(row -> sameVisibleConversation(row, target)).toList();
        if (matches.size() != 1) {
            throw new IllegalStateException("BOSS 会话 DOM 映射不唯一，已停止操作（匹配数=" + matches.size() + "）");
        }
        clickConversationIndex(matches.get(0).domIndex());
    }

    public void openConversation(ChatSession target) {
        Objects.requireNonNull(target, "target");
        UnreadConversation visible = new UnreadConversation(-1, 0, target.hrName(), target.companyName(), target.jobName(), target.lastMessage(), target.lastTime());
        openConversation(visible);
    }

    public void fillAndSend(String text) {
        requireNonBlank(text, "回复内容");
        requireSuccess(commandRunner.run(List.of("browser", sessionName, "state"), timeout), "发送前检查 BOSS 页面状态");
        var fill = commandRunner.run(List.of("browser", sessionName, "fill", "#chat-input", text), timeout);
        requireSuccess(fill, "填写 BOSS 回复");
        requireExactWriteEnvelope(fill.stdout(), "filled");
        JsonNode fillEnvelope = parseJson(fill.stdout());
        if (!fillEnvelope.path("filled").asBoolean(false) || !fillEnvelope.path("verified").asBoolean(false)) {
            throw new IllegalStateException("BOSS 输入框未通过填写校验");
        }
        requireExactWriteEnvelope(requireSuccess(commandRunner.run(
                List.of("browser", sessionName, "focus", "#chat-input"), timeout), "聚焦 BOSS 输入框"), "focused");
        String pressed = requireSuccess(commandRunner.run(
                List.of("browser", sessionName, "keys", "Enter"), timeout), "提交 BOSS 回复");
        if (!pressed.contains("Pressed: Enter")) {
            throw new IllegalStateException("OpenCLI 未确认 Enter 键操作，发送结果未知");
        }
    }

    public ChatSession matchUnique(UnreadConversation row, List<ChatSession> sessions) {
        List<ChatSession> matches = sessions.stream()
                .filter(session -> compatible(row.hrName(), session.hrName()))
                .filter(session -> compatible(row.companyName(), session.companyName()))
                .filter(session -> compatible(row.lastMessage(), session.lastMessage()))
                .sorted(Comparator.comparing(ChatSession::uid))
                .toList();
        if (matches.size() != 1) {
            throw new IllegalStateException("未读红点与 OpenCLI 会话身份映射不唯一（匹配数=" + matches.size() + "）");
        }
        return matches.get(0);
    }

    private void clickConversationIndex(int index) {
        var result = commandRunner.run(List.of("browser", sessionName, "click", CHAT_ROW_SELECTOR, "--nth", Integer.toString(index)), timeout);
        requireSuccess(result, "打开 BOSS 会话");
        requireExactWriteEnvelope(result.stdout(), "clicked");
        requireSuccess(commandRunner.run(List.of("browser", sessionName, "wait", "time", "1"), timeout), "等待 BOSS 会话加载");
    }

    private void requireExactWriteEnvelope(String output, String actionField) {
        JsonNode envelope = parseJson(output);
        if (!envelope.path(actionField).asBoolean(false) || envelope.path("matches_n").asInt(1) != 1) {
            throw new IllegalStateException("OpenCLI DOM 操作没有唯一命中目标");
        }
        String level = envelope.path("match_level").asText("exact");
        if ("reidentified".equalsIgnoreCase(level)) {
            throw new IllegalStateException("OpenCLI 仅通过重识别命中元素，已停止高风险操作");
        }
    }

    private UnreadConversation toUnreadConversation(JsonNode node) {
        return new UnreadConversation(node.path("domIndex").asInt(-1), node.path("unreadCount").asInt(0),
                text(node, "hrName"), text(node, "companyName"), text(node, "jobName"),
                text(node, "lastMessage"), text(node, "lastTime"));
    }

    private boolean sameVisibleConversation(UnreadConversation left, UnreadConversation right) {
        return compatible(left.hrName(), right.hrName())
                && compatible(left.companyName(), right.companyName())
                && compatible(left.lastMessage(), right.lastMessage());
    }

    private boolean compatible(String left, String right) {
        String a = normalize(left);
        String b = normalize(right);
        if (a.isBlank() || b.isBlank()) return true;
        return a.equals(b) || a.contains(b) || b.contains(a);
    }

    private String normalize(String value) {
        return value == null ? "" : value.replaceAll("\\s+", "").toLowerCase(Locale.ROOT);
    }

    private String requireSuccess(OpenCliCommandRunner.CommandResult result, String action) {
        if (!result.success()) throw new IllegalStateException(action + "失败：" + conciseFailure(result));
        return result.stdout();
    }

    private String conciseFailure(OpenCliCommandRunner.CommandResult result) {
        if (result.timedOut()) return "命令超时，结果未知";
        String detail = result.stderr().isBlank() ? result.stdout() : result.stderr();
        detail = detail.replaceAll("(?i)(authorization|token|cookie)[:=]\\s*[^\\s,]+", "$1=[REDACTED]");
        return detail.length() > 500 ? detail.substring(0, 500) : detail;
    }

    private JsonNode parseJson(String output) {
        try {
            return objectMapper.readTree(output);
        } catch (Exception e) {
            throw new IllegalStateException("OpenCLI 返回的不是有效 JSON", e);
        }
    }

    private String text(JsonNode node, String field) {
        return node.path(field).asText("").trim();
    }

    private void requireNonBlank(String value, String label) {
        if (value == null || value.isBlank()) throw new IllegalArgumentException(label + "不能为空");
    }

    private GatewayStatus cacheStatus(GatewayStatus value) {
        cachedStatus = value;
        cachedStatusAt = Instant.now();
        return value;
    }
}
