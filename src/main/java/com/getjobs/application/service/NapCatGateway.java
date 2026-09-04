package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.WebSocket;
import java.time.Duration;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

@Slf4j
@Service
public class NapCatGateway {
    private static final Pattern SIMPLE_COMMAND = Pattern.compile("^(发送|跳过|详情)\\s*(\\d{4})$");
    private static final Pattern REVISE_COMMAND = Pattern.compile("^修改\\s*(\\d{4})\\s+([\\s\\S]{1,500})$");

    private final ProfileService profileService;
    private final HrAssistantStore store;
    private final HrReplyActionService actions;
    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final AtomicBoolean connecting = new AtomicBoolean(false);
    private volatile WebSocket socket;
    private volatile String connectionFingerprint = "";

    public NapCatGateway(ProfileService profileService,
                         HrAssistantStore store,
                         HrReplyActionService actions,
                         ObjectMapper objectMapper) {
        this.profileService = profileService;
        this.store = store;
        this.actions = actions;
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(10)).build();
    }

    public boolean isConnected() {
        return socket != null && !socket.isOutputClosed();
    }

    @Scheduled(fixedDelay = 30_000, initialDelay = 5_000)
    public void keepConnected() {
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) return;
        HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(profileId);
        if (!settings.qqEnabled()) {
            closeSocket();
            return;
        }
        String fingerprint = settings.napcatWsUrl() + "|" + storeHash(settings.napcatToken()) + "|" + storeHash(settings.qqTarget());
        if (isConnected() && fingerprint.equals(connectionFingerprint)) return;
        if (isConnected()) closeSocket();
        connect(profileId, settings, fingerprint);
    }

    public boolean notifyProposal(ProposalView proposal) {
        HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(proposal.profileId());
        if (!settings.qqEnabled() || !isConnected()) return false;
        String text = "【BOSS HR 待确认】\n" + proposal.companyName() + " / " + proposal.jobName() + " / " + proposal.hrName() +
                "\nHR：" + truncate(proposal.sourceMessage(), 180) +
                "\n建议：" + truncate(proposal.draft().isBlank() ? "需要你补充信息或人工查看" : proposal.draft(), 300) +
                "\n确认码：" + proposal.confirmationCode() +
                "\n命令：发送 " + proposal.confirmationCode() + "｜修改 " + proposal.confirmationCode() + " 新文本｜跳过 " + proposal.confirmationCode();
        return sendPrivate(settings.qqTarget(), text);
    }

    public boolean notifySystemFault(Long profileId, String message) {
        HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(profileId);
        if (!settings.qqEnabled() || !isConnected()) return false;
        return sendPrivate(settings.qqTarget(), "【BOSS HR 值守已暂停】\n" + truncate(message, 500) + "\n请回到 BOSS 页面人工检查。");
    }

    private void connect(Long profileId, HrAssistantStore.SettingsSecret settings, String fingerprint) {
        if (!connecting.compareAndSet(false, true)) return;
        try {
            httpClient.newWebSocketBuilder()
                    .header("Authorization", "Bearer " + settings.napcatToken())
                    .connectTimeout(Duration.ofSeconds(10))
                    .buildAsync(URI.create(settings.napcatWsUrl()), new Listener(profileId, settings.qqTarget()))
                    .whenComplete((webSocket, error) -> {
                        connecting.set(false);
                        if (error != null) {
                            log.warn("NapCat WebSocket 连接失败: {}", safeMessage(error));
                            return;
                        }
                        socket = webSocket;
                        connectionFingerprint = fingerprint;
                    });
        } catch (RuntimeException e) {
            connecting.set(false);
            log.warn("NapCat WebSocket 配置无效: {}", safeMessage(e));
        }
    }

    void handleIncoming(Long profileId, String allowedQq, String payload) {
        try {
            JsonNode root = objectMapper.readTree(payload);
            if (!"message".equals(root.path("post_type").asText()) || !"private".equals(root.path("message_type").asText())) return;
            String sender = root.path("user_id").asText("");
            if (sender.equals(root.path("self_id").asText(""))) return;
            if (!allowedQq.equals(sender)) return;
            String messageId = root.path("message_id").asText("");
            String commandText = root.path("raw_message").asText("").trim();
            if (commandText.isBlank()) return;

            Matcher revise = REVISE_COMMAND.matcher(commandText);
            Matcher simple = SIMPLE_COMMAND.matcher(commandText);
            String commandType = revise.matches() ? "修改" : simple.matches() ? simple.group(1) : "";
            if (commandType.isBlank()) return;
            if (!store.rememberQqCommand(messageId, sender, commandType)) return;

            ProposalView result;
            if (revise.matches()) {
                result = actions.reviseByCode(profileId, revise.group(1), revise.group(2));
                sendPrivate(allowedQq, "已更新草稿【" + result.confirmationCode() + "】：" + truncate(result.draft(), 300));
                return;
            }
            String code = simple.group(2);
            result = switch (simple.group(1)) {
                case "发送" -> actions.sendByCode(profileId, code);
                case "跳过" -> actions.skipByCode(profileId, code);
                case "详情" -> actions.detailByCode(profileId, code);
                default -> throw new IllegalArgumentException("不支持的 QQ 指令");
            };
            sendPrivate(allowedQq, formatCommandResult(simple.group(1), result));
        } catch (RuntimeException e) {
            sendPrivate(allowedQq, "操作未执行：" + safeMessage(e));
        } catch (Exception e) {
            log.warn("NapCat 消息解析失败: {}", safeMessage(e));
        }
    }

    private String formatCommandResult(String command, ProposalView proposal) {
        if ("详情".equals(command)) {
            return "【" + proposal.confirmationCode() + "】" + proposal.companyName() + " / " + proposal.jobName() +
                    "\nHR：" + truncate(proposal.sourceMessage(), 300) + "\n草稿：" + truncate(proposal.draft(), 500) +
                    "\n状态：" + proposal.status();
        }
        return "任务【" + proposal.confirmationCode() + "】已处理，当前状态：" + proposal.status();
    }

    private boolean sendPrivate(String qqTarget, String message) {
        WebSocket current = socket;
        if (current == null || current.isOutputClosed() || !qqTarget.matches("\\d{5,15}")) return false;
        try {
            String payload = objectMapper.writeValueAsString(java.util.Map.of(
                    "action", "send_private_msg",
                    "params", java.util.Map.of("user_id", Long.parseLong(qqTarget), "message", message),
                    "echo", "hr-assistant-" + System.nanoTime()));
            current.sendText(payload, true);
            return true;
        } catch (Exception e) {
            log.warn("NapCat 私聊通知发送失败: {}", safeMessage(e));
            return false;
        }
    }

    private void closeSocket() {
        WebSocket current = socket;
        socket = null;
        connectionFingerprint = "";
        if (current != null && !current.isOutputClosed()) current.sendClose(WebSocket.NORMAL_CLOSURE, "disabled");
    }

    private String storeHash(String value) {
        return Integer.toHexString((value == null ? "" : value).hashCode());
    }

    private String truncate(String value, int max) {
        String safe = value == null ? "" : value;
        return safe.length() <= max ? safe : safe.substring(0, max);
    }

    private String safeMessage(Throwable error) {
        String value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return value.length() <= 300 ? value : value.substring(0, 300);
    }

    @PreDestroy
    public void shutdown() {
        closeSocket();
    }

    private final class Listener implements WebSocket.Listener {
        private final Long profileId;
        private final String allowedQq;
        private final StringBuilder fragments = new StringBuilder();

        private Listener(Long profileId, String allowedQq) {
            this.profileId = profileId;
            this.allowedQq = allowedQq;
        }

        @Override
        public void onOpen(WebSocket webSocket) {
            webSocket.request(1);
        }

        @Override
        public CompletionStage<?> onText(WebSocket webSocket, CharSequence data, boolean last) {
            fragments.append(data);
            if (last) {
                String payload = fragments.toString();
                fragments.setLength(0);
                handleIncoming(profileId, allowedQq, payload);
            }
            webSocket.request(1);
            return java.util.concurrent.CompletableFuture.completedFuture(null);
        }

        @Override
        public CompletionStage<?> onClose(WebSocket webSocket, int statusCode, String reason) {
            if (socket == webSocket) socket = null;
            return java.util.concurrent.CompletableFuture.completedFuture(null);
        }

        @Override
        public void onError(WebSocket webSocket, Throwable error) {
            if (socket == webSocket) socket = null;
            log.warn("NapCat WebSocket 已断开: {}", safeMessage(error));
        }
    }
}
