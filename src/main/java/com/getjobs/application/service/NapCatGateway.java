package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
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
    private HrProfileGuard profileGuard = new HrProfileGuard();
    @org.springframework.beans.factory.annotation.Autowired
    public void setProfileGuard(HrProfileGuard guard) { this.profileGuard=guard; }
    private final java.util.concurrent.ExecutorService incomingCommands = new java.util.concurrent.ThreadPoolExecutor(
            1,1,0L,java.util.concurrent.TimeUnit.MILLISECONDS,new java.util.concurrent.ArrayBlockingQueue<>(100),
            runnable -> {var thread=new Thread(runnable,"hr-qq-commands");thread.setDaemon(true);return thread;});
    private HrAutopilotStore autopilot;
    @org.springframework.beans.factory.annotation.Autowired
    public void setAutopilot(HrAutopilotStore autopilot) { this.autopilot=autopilot; }
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
    public void keepConnected() { profileGuard.locked(()-> { keepConnectedLocked(); return null; }); }
    private void keepConnectedLocked() {
        Long profileId = profileService.getCurrentProfileIdOrNull();
        if (profileId == null) {closeSocket(); return;}
        HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(profileId);
        if (!settings.qqEnabled()) {
            closeSocket();
            return;
        }
        String fingerprint = fingerprint(profileId,settings);
        if (isConnected() && fingerprint.equals(connectionFingerprint)) return;
        if (isConnected()) closeSocket();
        connect(profileId, settings, fingerprint);
    }

    public boolean notifyProposal(ProposalView proposal) {
        var settings=store.loadSettingsSecret(proposal.profileId());
        if(!settings.qqEnabled()) return false;
        String source=proposal.sourceMessage();
        com.getjobs.application.hr.HrAssistantTypes.ChatCapture capture=null;
        if(autopilot!=null) {
            try { capture=autopilot.context(proposal.profileId(),proposal.conversationId()); source=HrAutopilotService.latestRound(capture.messages()); }
            catch(RuntimeException ignored) { source += "\n[上下文未完整采集]"; }
        }
        String text="【BOSS HR 需要决策】\n"+proposal.companyName()+" / "+proposal.jobName()+" / "+proposal.hrName()
                +"\nHR本轮："+source+"\nAI建议："+(proposal.draft().isBlank()?"尚无可安全发送的正文":proposal.draft())
                +"\n转人工原因："+(autopilot==null?"需要用户确认":autopilot.decisionReason(proposal.id()))
                +"\n待决策："+proposal.summary()+"\n"+String.join("；",proposal.missingFacts())
                +"\n确认码："+proposal.confirmationCode()+"\n发送/修改/跳过/详情/补充 "+proposal.confirmationCode()
                +"\n记住 内容 → 确认记住 原文（仅明确确认才长期保存）";
        boolean queued=sendConfigured(settings,text,"proposal:"+proposal.id()+":"+proposal.version());
        if(capture!=null) {
            int part=0;
            // Forward all media from the latest inbound round, never avatars or earlier unrelated files.
            var messages=capture.messages(); int start=messages.size();
            while(start>0 && messages.get(start-1).inbound()) start--;
            for(var m:messages.subList(start,messages.size())) for(var media:m.media()) {
                String data=media.dataUrl()==null?"":media.dataUrl();
                if((data.startsWith("data:image/") || data.startsWith("data:audio/") || data.startsWith("data:application/pdf;")
                        || data.startsWith("data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;")) && data.contains(";base64,")) {
                    try {
                        var payload=objectMapper.readTree(buildNotificationPayload(settings,""));
                        String mediaType=data.startsWith("data:image/")?"image":data.startsWith("data:audio/")?"record":"file";
                        var segment=java.util.Map.of("type",mediaType,"data",java.util.Map.of("file","base64://"+data.substring(data.indexOf(',')+1),"name",media.name()));
                        ((com.fasterxml.jackson.databind.node.ObjectNode)payload.path("params")).set("message",objectMapper.valueToTree(java.util.List.of(segment)));
                        autopilot.enqueue(proposal.profileId(),"proposal-media:"+proposal.id()+":"+proposal.version()+":"+(part++),payload.toString());
                    } catch(Exception e) { queued=false; }
                } else {
                    queued &= sendConfigured(settings,"【"+proposal.confirmationCode()+"】媒体："+media.name()+"\n读取状态："+media.readStatus()
                            +"\n"+media.extractedText()+"\n原始内容可在工作台详情查看；未取得时需回到BOSS查看。",
                            "proposal-media:"+proposal.id()+":"+proposal.version()+":"+(part++));
                }
            }
        }
        return queued;
    }

    public boolean notifySystemFault(Long profileId, String message) {
        var settings=store.loadSettingsSecret(profileId);
        if(!settings.qqEnabled()) return false;
        return sendConfigured(settings,"【BOSS HR 需要人工处理】\n"+message,"fault:"+profileId+":"+storeHash(message));
    }

    @Scheduled(fixedDelay=2000)
    public void flushNotifications() { profileGuard.locked(()-> { flushNotificationsLocked(); return null; }); }
    private void flushNotificationsLocked() {
        Long profileId=profileService.getCurrentProfileIdOrNull();
        if(autopilot==null || profileId==null) return;
        autopilot.queueUnreportedFaults(profileId);
        if(!isConnected()) return;
        var settings=store.loadSettingsSecret(profileId);
        if(!settings.qqEnabled() || !connectionFingerprint.equals(fingerprint(profileId,settings))) return;
        for(var delivery:autopilot.pending(profileId)) {
            if(!autopilot.dispatching(delivery.id())) continue;
            try {
                var payload=(com.fasterxml.jackson.databind.node.ObjectNode)objectMapper.readTree(delivery.payload());
                String targetKey=settings.qqTargetType()==QqTargetType.GROUP?"group_id":"user_id";
                if(!settings.qqTarget().equals(payload.path("params").path(targetKey).asText())) {
                    autopilot.receipt(delivery.id(),false,""); continue;
                }
                payload.put("echo","hr-delivery:"+delivery.id());
                // UNKNOWN is persisted before the write. An interrupted or ambiguous write is never retried.
                sendPayload(payload.toString(),"QQ 通知结果未知");
            } catch(Exception ignored) { /* retain UNKNOWN for manual reconciliation */ }
        }
    }

    private void connect(Long profileId, HrAssistantStore.SettingsSecret settings, String fingerprint) {
        if (!connecting.compareAndSet(false, true)) return;
        try {
            httpClient.newWebSocketBuilder()
                    .header("Authorization", "Bearer " + settings.napcatToken())
                    .connectTimeout(Duration.ofSeconds(10))
                    .buildAsync(URI.create(settings.napcatWsUrl()), new Listener(profileId,fingerprint))
                    .whenComplete((webSocket, error) -> {
                        connecting.set(false);
                        if (error != null) {
                            log.warn("NapCat WebSocket 连接失败: {}", safeMessage(error));
                            return;
                        }
                        profileGuard.locked(()-> {
                            Long current=profileService.getCurrentProfileIdOrNull();
                            if(!profileId.equals(current) || !fingerprint.equals(fingerprint(current,store.loadSettingsSecret(current)))) {
                                webSocket.abort(); return null;
                            }
                            socket = webSocket;
                            connectionFingerprint = fingerprint;
                            return null;
                        });
                    });
        } catch (RuntimeException e) {
            connecting.set(false);
            log.warn("NapCat WebSocket 配置无效: {}", safeMessage(e));
        }
    }

    void handleIncoming(Long profileId, String payload) {
        String operatorQq = "";
        try {
            HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(profileId);
            if (!settings.qqEnabled()) return;
            JsonNode root = objectMapper.readTree(payload);
            if(root.path("echo").asText("").startsWith("hr-delivery:")) {
                String id=root.path("echo").asText().substring("hr-delivery:".length());
                boolean ok=root.path("retcode").isInt() && root.path("retcode").asInt()==0
                        && "ok".equals(root.path("status").asText()) && !root.path("data").path("message_id").asText("").isBlank();
                if(autopilot!=null) autopilot.receipt(id,ok,root.path("data").path("message_id").asText(""));
                return;
            }
            if (!"message".equals(root.path("post_type").asText())) return;
            String sender = root.path("user_id").asText("");
            if (sender.equals(root.path("self_id").asText(""))) return;
            operatorQq = commandOperator(settings);
            if (operatorQq.isBlank() || !operatorQq.equals(sender) || !matchesCommandChannel(settings, root)) return;
            String messageId = root.path("message_id").asText("");
            if (messageId.isBlank()) return;
            String commandText = root.path("raw_message").asText("").trim();
            if (commandText.isBlank()) return;

            if(autopilot!=null && handleAutopilotCommand(profileId,settings,messageId,sender,commandText)) return;
            Matcher revise = REVISE_COMMAND.matcher(commandText);
            Matcher simple = SIMPLE_COMMAND.matcher(commandText);
            String commandType = revise.matches() ? "修改" : simple.matches() ? simple.group(1) : "";
            if (commandType.isBlank()) return;
            if (!store.rememberQqCommand(messageId, sender, commandType)) return;

            ProposalView result;
            if (revise.matches()) {
                result = actions.reviseByCode(profileId, revise.group(1), revise.group(2));
                sendConfigured(settings, "已更新草稿【" + result.confirmationCode() + "】：" + result.draft()+"\n旧确认码已作废，请使用新确认码发送。");
                return;
            }
            String code = simple.group(2);
            result = switch (simple.group(1)) {
                case "发送" -> actions.sendByCode(profileId, code);
                case "跳过" -> actions.skipByCode(profileId, code);
                case "详情" -> actions.detailByCode(profileId, code);
                default -> throw new IllegalArgumentException("不支持的 QQ 指令");
            };
            sendConfigured(settings, formatCommandResult(simple.group(1), result));
        } catch (RuntimeException e) {
            if (!operatorQq.isBlank()) sendConfigured(store.loadSettingsSecret(profileId), "操作未执行：" + safeMessage(e));
        } catch (Exception e) {
            log.warn("NapCat 消息解析失败: {}", safeMessage(e));
        }
    }

    private boolean matchesCommandChannel(HrAssistantStore.SettingsSecret settings, JsonNode root) {
        String messageType = root.path("message_type").asText("");
        if (settings.qqTargetType() == QqTargetType.PRIVATE) {
            return "private".equals(messageType);
        }
        return "group".equals(messageType) && settings.qqTarget().equals(root.path("group_id").asText(""));
    }

    private String commandOperator(HrAssistantStore.SettingsSecret settings) {
        return settings.qqTargetType() == QqTargetType.PRIVATE ? settings.qqTarget() : settings.qqOperator();
    }

    private boolean commandsEnabled(HrAssistantStore.SettingsSecret settings) {
        return !commandOperator(settings).isBlank();
    }

    private String formatCommandResult(String command, ProposalView proposal) {
        if ("详情".equals(command)) {
            return "【" + proposal.confirmationCode() + "】" + proposal.companyName() + " / " + proposal.jobName() +
                    "\nHR：" + proposal.sourceMessage() + "\n草稿：" + proposal.draft() +
                    "\n状态：" + proposal.status();
        }
        return "任务【" + proposal.confirmationCode() + "】" + ("APPROVED".equals(proposal.status()) ? "已排队，尚未确认发出" : "当前状态：" + proposal.status());
    }

    private boolean sendPrivate(String qqTarget, String message) {
        return sendPayload(buildPrivatePayload(qqTarget, message), "NapCat 私聊通知发送失败");
    }

    private boolean sendConfigured(HrAssistantStore.SettingsSecret settings, String message) {
        return sendConfigured(settings,message,"reply:"+java.util.UUID.randomUUID());
    }
    private boolean sendConfigured(HrAssistantStore.SettingsSecret settings, String message,String key) {
        if(autopilot==null) return sendPayload(buildNotificationPayload(settings,message),"NapCat QQ 通知发送失败");
        if(!settings.qqEnabled() || !validQqId(settings.qqTarget())) return false;
        int part=0;
        for(int start=0;start<message.length();) {
            int end=Math.min(message.length(),start+1500);
            if(end<message.length() && Character.isHighSurrogate(message.charAt(end-1))) end--;
            autopilot.enqueue(settings.profileId(),key+":"+(part++),buildNotificationPayload(settings,message.substring(start,end)));
            start=end;
        }
        return true;
    }

    private boolean handleAutopilotCommand(Long profileId,HrAssistantStore.SettingsSecret settings,String messageId,String sender,String text) {
        boolean special=text.equals("暂停")||text.equals("恢复")||text.startsWith("补充 ")||text.startsWith("记住 ")||text.startsWith("确认记住 ")||text.startsWith("详情 ");
        if(!special) return false;
        if(!store.rememberQqCommand(messageId,sender,"托管指令")) return true;
        if(text.equals("暂停")||text.equals("恢复")) {
            autopilot.pause(profileId,text.equals("暂停"));
            sendConfigured(settings,text.equals("暂停")?"已暂停托管，停止新扫描和发送；已触发动作仍核验结果。":"已允许恢复托管；专用标签的手动暂停需在该标签明确恢复。");
        } else if(text.startsWith("记住 ")||text.startsWith("确认记住 ")) {
            boolean confirm=text.startsWith("确认记住 ");
            String fact=text.substring(confirm?5:3).trim();
            autopilot.remember(profileId,fact,confirm);
            sendConfigured(settings,confirm?"已记入当前人物档案："+fact:"请复核，再发送：确认记住 "+fact);
        } else if(text.startsWith("补充 ")) {
            var matcher=Pattern.compile("^补充\\s+(\\d{4})\\s+([\\s\\S]+)$").matcher(text);
            if(!matcher.matches()) throw new IllegalArgumentException("用法：补充 确认码 本次事实");
            var result=actions.supplementByCode(profileId,matcher.group(1),matcher.group(2));
            sendConfigured(settings,"本次补充已生成新草稿【"+result.confirmationCode()+"】："+result.draft()+"\n旧确认码失效，需使用新码发送。");
        } else {
            var parts=text.split("\\s+");
            var capture=(com.getjobs.application.hr.HrAssistantTypes.ChatCapture)actions.contextByCode(profileId,parts[1]);
            int page=parts.length>2?Integer.parseInt(parts[2]):1;
            int pages=Math.max(1,(capture.messages().size()+9)/10);
            if(page<1||page>pages) throw new IllegalArgumentException("页码超出范围，共"+pages+"页");
            StringBuilder detail=new StringBuilder("【"+parts[1]+"】上下文 "+page+"/"+pages+"页\n");
            detail.append(capture.contextComplete()?"本次上下文已完整读取\n":"上下文未确认完整，不能据此自动作答\n");
            for(var m:capture.messages().subList((page-1)*10,Math.min(page*10,capture.messages().size()))) {
                detail.append(m.from()).append(" [").append(m.type()).append("] ").append(m.text()).append("\n");
                for(var item:m.media()) detail.append(item.name()).append(" [").append(item.readStatus()).append("] ").append(item.extractedText()).append("\n");
            }
            if(page<pages) detail.append("下一页：详情 ").append(parts[1]).append(" ").append(page+1);
            sendConfigured(settings,detail.toString());
        }
        return true;
    }

    String buildNotificationPayload(HrAssistantStore.SettingsSecret settings, String message) {
        if (settings == null || !validQqId(settings.qqTarget())) return "";
        String action = settings.qqTargetType() == QqTargetType.GROUP ? "send_group_msg" : "send_private_msg";
        String targetKey = settings.qqTargetType() == QqTargetType.GROUP ? "group_id" : "user_id";
        return buildPayload(action, targetKey, settings.qqTarget(), message);
    }

    private String buildPrivatePayload(String qqTarget, String message) {
        if (!validQqId(qqTarget)) return "";
        return buildPayload("send_private_msg", "user_id", qqTarget, message);
    }

    private String buildPayload(String action, String targetKey, String target, String message) {
        try {
            return objectMapper.writeValueAsString(java.util.Map.of(
                    "action", action,
                    "params", java.util.Map.of(targetKey, Long.parseLong(target), "message", java.util.List.of(java.util.Map.of("type","text","data",java.util.Map.of("text",message)))),
                    "echo", "hr-assistant-" + System.nanoTime()));
        } catch (Exception e) {
            log.warn("NapCat 消息序列化失败: {}", safeMessage(e));
            return "";
        }
    }

    private boolean sendPayload(String payload, String failureMessage) {
        WebSocket current = socket;
        if (current == null || current.isOutputClosed() || payload.isBlank()) return false;
        try {
            current.sendText(payload, true);
            return true;
        } catch (Exception e) {
            log.warn("{}: {}", failureMessage, safeMessage(e));
            return false;
        }
    }

    private boolean validQqId(String value) {
        return value != null && value.matches("\\d{5,15}");
    }

    private void closeSocket() {
        WebSocket current = socket;
        socket = null;
        connectionFingerprint = "";
        if (current != null && !current.isOutputClosed()) current.sendClose(WebSocket.NORMAL_CLOSURE, "disabled");
    }

    private String fingerprint(Long profileId,HrAssistantStore.SettingsSecret settings) {
        return profileId+"|"+settings.qqEnabled()+"|"+settings.napcatWsUrl()+"|"+storeHash(settings.napcatToken())+"|"
                +settings.qqTargetType()+"|"+storeHash(settings.qqTarget())+"|"+storeHash(settings.qqOperator());
    }
    private String storeHash(String value) {
        try {return java.util.HexFormat.of().formatHex(java.security.MessageDigest.getInstance("SHA-256")
                .digest(java.util.Objects.toString(value,"").getBytes(java.nio.charset.StandardCharsets.UTF_8)));}
        catch(java.security.NoSuchAlgorithmException e) {throw new IllegalStateException(e);}
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
        incomingCommands.shutdownNow();
        closeSocket();
    }

    private final class Listener implements WebSocket.Listener {
        private final Long profileId;
        private final String fingerprint;
        private final StringBuilder fragments = new StringBuilder();

        private Listener(Long profileId,String fingerprint) {
            this.profileId = profileId;
            this.fingerprint=fingerprint;
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
                try {
                    incomingCommands.execute(()->profileGuard.locked(()-> {
                        Long current=profileService.getCurrentProfileIdOrNull();
                        if(socket==webSocket && profileId.equals(current) && fingerprint.equals(connectionFingerprint)
                                && fingerprint.equals(fingerprint(profileId,store.loadSettingsSecret(profileId)))) handleIncoming(profileId,payload);
                        return null;
                    }));
                } catch(java.util.concurrent.RejectedExecutionException e) {
                    log.warn("QQ 指令队列已满，未处理本次消息");
                }
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
