package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.ChromeBridgeStatus;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.ScanReceipt;
import com.getjobs.application.hr.HrAssistantTypes.WatchStatus;
import com.getjobs.application.hr.HrAssistantTypes.BackgroundBinding;
import com.getjobs.application.hr.HrAssistantTypes.PageObservation;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.time.LocalDateTime;
import java.time.Instant;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@Slf4j
@Service
public class HrAssistantWatchService {
    private HrAutopilotService autopilot;
    @org.springframework.beans.factory.annotation.Autowired
    public void setAutopilot(HrAutopilotService autopilot) { this.autopilot = autopilot; }
    private HrBackgroundStore background;
    @org.springframework.beans.factory.annotation.Autowired
    public void setBackground(HrBackgroundStore background) { this.background=background; }
    private final ExecutorService analysisExecutor=Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());
    private final AtomicBoolean processingBackground=new AtomicBoolean();
    private volatile long pageObservedAt;
    private volatile String backgroundBlocker="";
    @jakarta.annotation.PostConstruct void recoverBackground() { if(background!=null)background.recover(); }
    @jakarta.annotation.PreDestroy void shutdownBackground() {
        analysisExecutor.shutdownNow();
        try {analysisExecutor.awaitTermination(3,java.util.concurrent.TimeUnit.SECONDS);}
        catch(InterruptedException e){Thread.currentThread().interrupt();}
    }
    private static final long SCAN_INTERVAL_MS = 60_000L;
    private final ProfileService profileService;
    private final HrAssistantStore store;
    private final HrReplyDraftService draftService;
    private final HrAssistantEventService events;
    private final NapCatGateway napCatGateway;
    private final int maxConversations;
    private final HrProfileGuard profileGuard;
    private final AtomicBoolean watching = new AtomicBoolean(false);
    private final AtomicBoolean processingScan = new AtomicBoolean(false);
    private volatile boolean browserScanRunning;
    private final Set<String> trialUids = new HashSet<>();
    private final Set<Long> trialProposalIds = new HashSet<>();
    private volatile boolean reviewReady;
    public boolean isReviewTrial() { return session != null && session.reviewLimit() == 3; }
    public Set<Long> trialSendScope() { return reviewReady ? Set.copyOf(trialProposalIds) : Set.of(); }
    public void requireTrialSend(Long profileId, long proposalId) {
        profileGuard.locked(() -> {
            if (isReviewTrial() && (!watching.get() || !reviewReady || !session.profileId().equals(profileId) || !trialProposalIds.contains(proposalId)))
                throw new IllegalStateException("此卡片不属于当前已完成采集的三个会话，或连接已停止；未加入发送队列，请核对本轮卡片");
            return null;
        });
    }
    private volatile WatchSession session;
    private volatile LocalDateTime lastScanAt;
    private volatile LocalDateTime lastHeartbeatAt;
    private volatile String lastError = "";
    private volatile int outboxCount;
    private volatile long scanIntervalMs = SCAN_INTERVAL_MS;

    public HrAssistantWatchService(ProfileService profileService,
                                   HrAssistantStore store,
                                   HrReplyDraftService draftService,
                                   HrAssistantEventService events,
                                   NapCatGateway napCatGateway,
                                   @Value("${app.hr-assistant.max-conversations-per-scan:100}") int maxConversations,
                                   HrProfileGuard profileGuard) {
        this.profileService = profileService;
        this.profileGuard = profileGuard;
        profileGuard.registerBlocker(() -> watching.get() || processingScan.get() || processingBackground.get() || browserScanRunning || store.hasLeasedSendCommands());
        this.store = store;
        this.draftService = draftService;
        this.events = events;
        this.napCatGateway = napCatGateway;
        this.maxConversations = Math.max(1, Math.min(maxConversations, 100));
    }

    public WatchStatus start(int tabId, String url, String contentVersion, String browserSessionId, Long expectedProfileId) {
        return start(tabId, url, contentVersion, browserSessionId, expectedProfileId, 1);
    }

    public WatchStatus start(int tabId, String url, String contentVersion, String browserSessionId, Long expectedProfileId, int intervalMinutes) {
        return start(tabId, url, contentVersion, browserSessionId, expectedProfileId, intervalMinutes, 0);
    }

    public WatchStatus start(int tabId, String url, String contentVersion, String browserSessionId, Long expectedProfileId, int intervalMinutes, int reviewLimit) {
        return start(tabId,url,contentVersion,browserSessionId,expectedProfileId,intervalMinutes,reviewLimit,"CHROME_BRIDGE",null);
    }

    public WatchStatus start(int tabId, String url, String contentVersion, String browserSessionId, Long expectedProfileId,
                             int intervalMinutes, int reviewLimit,String transport,BackgroundBinding binding) {
        if (reviewLimit != 0 && reviewLimit != 3) throw new IllegalArgumentException("试运行仅支持三个会话");
        if (intervalMinutes != 1 && intervalMinutes != 30) throw new IllegalArgumentException("值守间隔仅支持 1 分钟或 30 分钟");
        return profileGuard.locked(() -> {
            if (expectedProfileId == null || !expectedProfileId.equals(profileService.getCurrentProfileId())) {
                throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请刷新后重新开始值守");
            }
            validateChatTab(tabId, url, contentVersion, browserSessionId);
            boolean hosted="CHROME_BACKGROUND".equals(transport);
            if(!hosted && !"CHROME_BRIDGE".equals(transport))throw new IllegalArgumentException("值守执行方式无效");
            if(hosted) {
                if(reviewLimit!=0 || !HrAutopilotStore.PROTOCOL.equals(contentVersion))throw new IllegalArgumentException("后台托管协议不匹配");
                validateBinding(binding);
                String profileName=profileService.getCurrentProfile()==null?"":profileService.getCurrentProfile().getName();
                if(!normalize(binding.accountName()).equals(normalize(profileName)) && !binding.accountBindingConfirmed())
                    throw new IllegalArgumentException("请确认当前 BOSS 账号属于所选人物档案");
                if(autopilot==null || !autopilot.policy(expectedProfileId).enabled())throw new IllegalStateException("请先确认并保存托管规则");
            }
            if (reviewLimit == 3) {
                if (!HrAutopilotStore.PROTOCOL.equals(contentVersion)) throw new IllegalStateException("请更新 HR 扩展后再试运行");
                if (autopilot != null && autopilot.policy(expectedProfileId).enabled() && "AUTO".equals(autopilot.policy(expectedProfileId).replyMode()))
                    throw new IllegalStateException("请先关闭自动托管，再进行三个会话试运行");
                if (!store.loadSettingsSecret(expectedProfileId).qqEnabled() || !napCatGateway.isConnected())
                    throw new IllegalStateException("请先连接已配置的 QQ 通知通道");
            }
            if(reviewLimit == 0 && autopilot!=null && autopilot.policy(expectedProfileId).enabled()
                    && ((!hosted && !url.contains("getjobs-autopilot=1")) || !contentVersion.equals(HrAutopilotStore.PROTOCOL)))
                throw new IllegalStateException("请打开新版扩展的专用托管聊天标签，再开始值守");
            if(reviewLimit == 0 && autopilot!=null && autopilot.policy(expectedProfileId).enabled()) {
                var blockers=dutyBlockers(expectedProfileId);
                if(!blockers.isEmpty()) throw new IllegalStateException(String.join("；",blockers));
            }
            if (watching.get()) {
                expirePageHeartbeat();
                if (watching.get() && session != null && session.tabId() == tabId && session.browserSessionId().equals(browserSessionId)
                        && session.reviewLimit() == reviewLimit && session.transport().equals(transport)
                        && (!hosted || sameBinding(session.binding(),binding))) return status();
                if(watching.get())
                throw new IllegalStateException("已有其他 BOSS 标签页正在值守，请先在原标签页停止");
            }
            profileGuard.requireChangeAllowed();
            Long profileId = profileService.getCurrentProfileId();
            session = new WatchSession(UUID.randomUUID().toString(), browserSessionId.trim(), profileId,
                    tabId, url.trim(), contentVersion.trim(), reviewLimit,transport,binding);
            trialUids.clear();
            trialProposalIds.clear();
            reviewReady = false;
            if (reviewLimit == 0) store.resumePendingCommands(profileId,session.watchSessionId());
            watching.set(true);
            scanIntervalMs = autopilot!=null && autopilot.policy(profileId).enabled() ? 60_000L : intervalMinutes * 60_000L;
            processingScan.set(false);
            browserScanRunning = false;
            lastScanAt = null;
            lastHeartbeatAt = LocalDateTime.now();
            pageObservedAt=hosted?binding.pageObservedAt():0;
            backgroundBlocker="";
            lastError = "";
            outboxCount = 0;
            WatchStatus status = status();
            events.emit("watch-status", status);
            return status;
        });
    }

    public WatchStatus stop(String watchSessionId, String reason) {
        return profileGuard.locked(() -> {
            if (session != null && watchSessionId != null && !watchSessionId.isBlank()
                    && !session.watchSessionId().equals(watchSessionId.trim())) {
                throw new HrAssistantStore.StaleProposalException("值守会话已变化，拒绝停止其他标签页的值守");
            }
            watching.set(false);
            // A stop cancels future work, but must not release an in-flight ingestion.
            browserScanRunning = false;
            lastError = safe(reason);
            if(isBackground())backgroundBlocker=lastError.startsWith("USER_STOPPED")?"USER_STOPPED":"HOST_PAUSED";
            if (session != null && !lastError.isBlank() && !lastError.startsWith("USER_STOPPED") && !lastError.startsWith("TRIAL_COMPLETED")) {
                napCatGateway.notifySystemFault(session.profileId(), lastError);
            }
            WatchStatus status = status();
            events.emit("watch-status", status);
            return status;
        });
    }

    public WatchStatus finishReview(String watchSessionId, int tabId) {
        return profileGuard.locked(() -> {
            requireSession(watchSessionId, tabId);
            if (!isReviewTrial() || processingScan.get()) throw new IllegalStateException("试运行采集尚未完成");
            reviewReady = true;
            browserScanRunning = false;
            lastError = "";
            events.emit("watch-status", status());
            return status();
        });
    }

    public WatchStatus heartbeat(String watchSessionId,
                                               int tabId,
                                               String url,
                                               String contentVersion,
                                               boolean browserScanRunning,
                                               int browserOutboxCount,
                                               String fault) {
        return heartbeat(watchSessionId,tabId,url,contentVersion,browserScanRunning,browserOutboxCount,fault,null);
    }

    public WatchStatus heartbeat(String watchSessionId,int tabId,String url,String contentVersion,
                                 boolean browserScanRunning,int browserOutboxCount,String fault,PageObservation observation) {
        return profileGuard.locked(() -> {
            requireSession(watchSessionId, tabId);
            validateChatTab(tabId, url, contentVersion, session.browserSessionId());
            requirePageObservation(observation,true);
            session = new WatchSession(session.watchSessionId(), session.browserSessionId(), session.profileId(),
                    tabId, url.trim(), contentVersion.trim(), session.reviewLimit(),session.transport(),session.binding());
            lastHeartbeatAt = LocalDateTime.now();
            if(browserScanRunning && !this.browserScanRunning && autopilot!=null) autopilot.scanStarted(session.profileId());
            this.browserScanRunning = browserScanRunning;
            outboxCount = Math.max(0, browserOutboxCount);
            if (fault != null && !fault.isBlank()) {
                lastError = concise(fault);
                watching.set(false);
                if(isBackground())backgroundBlocker="PAGE_FAULT";
                this.browserScanRunning = false;
                napCatGateway.notifySystemFault(session.profileId(), lastError);
                events.emit("watch-paused", java.util.Map.of("message", lastError));
            }
            return status();
        });
    }

    public ScanReceipt ingestScan(String watchSessionId,
                                  int tabId,
                                  String scanId,
                                  int totalUnread,
                                  List<ChatCapture> captures) {
        String normalizedScanId = requireNonBlank(scanId, "scanId");
        List<ChatCapture> safeCaptures = captures == null ? List.of() : List.copyOf(captures);
        if (safeCaptures.size() > maxConversations) throw new IllegalArgumentException("单轮 HR 会话数量超过 " + maxConversations);
        if (totalUnread > 0 && safeCaptures.isEmpty()) {
            throw new IllegalStateException("BOSS 显示有未读消息，但扩展未能安全识别任何带红点会话，值守已暂停");
        }
        Set<String> uniqueUids = new HashSet<>();
        for (ChatCapture capture : safeCaptures) {
            if (capture != null && capture.session() != null && !uniqueUids.add(safe(capture.session().uid()))) {
                throw new HrAssistantStore.StaleProposalException("同一轮扫描出现重复会话 UID，已暂停避免错误映射");
            }
        }
        WatchSession active = profileGuard.locked(() -> {
            WatchSession bound = requireSession(watchSessionId, tabId);
            if (reviewReady) throw new IllegalStateException("本轮采集已结束，仅等待已确认回复，不再读取其他会话");
            if (!processingScan.compareAndSet(false, true)) throw new IllegalStateException("上一轮 HR 消息仍在处理，本轮已跳过");
            return bound;
        });
        List<String> acknowledged = new ArrayList<>();
        int processed = 0;
        int duplicates = 0;
        try {
            HrAssistantStore.SettingsSecret settings = store.loadSettingsSecret(active.profileId());
            for (ChatCapture capture : safeCaptures) {
                requireSession(watchSessionId, tabId);
                validateCapture(capture);
                if (active.reviewLimit() == 3) {
                    if (trialUids.contains(capture.session().uid())) { duplicates++; acknowledged.add(capture.captureId()); continue; }
                    if (trialProposalIds.size() >= 3 || trialUids.size() >= 20) throw new IllegalStateException("三个会话试运行已达到上限，未处理更多会话");
                    trialUids.add(capture.session().uid());
                }
                boolean shouldProcess = store.beginCapture(active.profileId(), active.watchSessionId(), normalizedScanId, capture.captureId());
                if (!shouldProcess) {
                    duplicates++;
                    acknowledged.add(capture.captureId());
                    continue;
                }
                try {
                    Long proposalId = processCapture(active.profileId(), settings, capture);
                    if (active.reviewLimit() == 3 && proposalId != null) trialProposalIds.add(proposalId);
                    store.completeCapture(active.watchSessionId(), capture.captureId());
                    acknowledged.add(capture.captureId());
                    processed++;
                    if(autopilot!=null) autopilot.progress(active.profileId(),false);
                } catch (RuntimeException failure) {
                    store.failCapture(active.watchSessionId(), capture.captureId(), errorCode(failure));
                    throw failure;
                }
            }
            lastScanAt = LocalDateTime.now();
            if(!isReviewTrial() && autopilot!=null && safeCaptures.isEmpty() && totalUnread==0) autopilot.progress(active.profileId(),true);
            lastHeartbeatAt = lastScanAt;
            lastError = "";
            outboxCount = Math.max(0, outboxCount - acknowledged.size());
            ScanReceipt receipt = new ScanReceipt(normalizedScanId, safeCaptures.size(), processed, duplicates, acknowledged, trialProposalIds.size());
            events.emit("scan-complete", java.util.Map.of(
                    "processed", processed, "duplicates", duplicates, "totalUnread", Math.max(0, totalUnread),
                    "lastScanAt", lastScanAt.toString()));
            return receipt;
        } catch (RuntimeException failure) {
            lastError = concise(failure);
            events.emit("scan-failed", java.util.Map.of("message", lastError, "scanId", normalizedScanId));
            throw failure;
        } finally {
            processingScan.set(false);
        }
    }

    public HrBackgroundStore.CaptureAck acceptCapture(String watchSessionId,int tabId,String scanId,
                                                       List<ChatCapture> captures,PageObservation observation) {
        requireNonBlank(scanId,"scanId");
        if(captures==null || captures.size()!=1)throw new IllegalArgumentException("后台每次仅提交一条完整会话快照");
        ChatCapture capture=captures.getFirst();
        if(capture==null || capture.session()==null)throw new IllegalArgumentException("后台快照缺少会话身份");
        requireNonBlank(capture.captureId(),"captureId");requireNonBlank(capture.session().uid(),"平台会话 UID");
        return profileGuard.locked(()->{
            WatchSession active=requireSession(watchSessionId,tabId);
            if(!isBackground() || background==null || autopilot==null)throw new IllegalStateException("请先启用后台托管");
            requirePageObservation(observation,false);
            if(!dutyBlockers(active.profileId()).isEmpty())throw new IllegalStateException("托管资料或授权已变化，请重新核对");
            var ack=background.accept(active.profileId(),active.binding().accountIdentity(),autopilot.policy(active.profileId()).version(),capture);
            lastScanAt=LocalDateTime.now();
            return ack;
        });
    }

    @Scheduled(fixedDelay=500)
    public void processBackgroundCaptures() {
        if(background==null || autopilot==null || !processingBackground.compareAndSet(false,true))return;
        final WatchSession active;
        final HrBackgroundStore.Task task;
        try {
            var pair=profileGuard.locked(()->{
                expirePageHeartbeat();
                if(!watching.get() || !isBackground() || !session.profileId().equals(profileService.getCurrentProfileId())
                        || !dutyBlockers(session.profileId()).isEmpty())return null;
                return new Object[]{session,background.claim(session.profileId(),session.binding().accountIdentity(),autopilot.policy(session.profileId()).version())};
            });
            if(pair==null || pair[1]==null){processingBackground.set(false);return;}
            active=(WatchSession)pair[0];task=(HrBackgroundStore.Task)pair[1];
        }catch(RuntimeException e){processingBackground.set(false);throw e;}
        analysisExecutor.submit(()->{
            try {
                processCapture(active.profileId(),store.loadSettingsSecret(active.profileId()),task.capture(),active);
                background.finish(task.id(),"");
                autopilot.progress(active.profileId(),false);
            }catch(BackgroundInterrupted e){background.defer(task.id());}
            catch(RuntimeException error) {
                String code=error instanceof HrBackgroundStore.IdentityHeldException?"LEGACY_IDENTITY_UNRESOLVED":errorCode(error);
                background.finish(task.id(),code);
                // Captured text is encrypted and retained. Fault notices contain no chat text.
                napCatGateway.notifySystemFault(active.profileId(),code.equals("LEGACY_IDENTITY_UNRESOLVED")?
                        "旧视觉发送记录需要只读身份核验，相关新身份未自动发送":"后台聊天分析未完成，请在工作台检查");
                events.emit("background-capture-blocked",java.util.Map.of("errorCode",code));
            } finally {processingBackground.set(false);}
        });
    }

    public WatchStatus status() {
        return profileGuard.locked(this::statusLocked);
    }

    public List<String> dutyBlockers(Long profileId) {
        var result=new ArrayList<String>(autopilot==null?List.of("托管服务不可用"):autopilot.blockers(profileId));
        if(autopilot!=null && "AUTO".equals(autopilot.policy(profileId).replyMode()) && !napCatGateway.isConnected()) result.add("QQ 决策通道未连接");
        return result;
    }

    private WatchStatus statusLocked() {
        expirePageHeartbeat();
        var currentProfile = profileService.getCurrentProfile();
        WatchSession active = session;
        LocalDateTime next = watching.get() && !reviewReady && lastScanAt != null ? lastScanAt.plusNanos(scanIntervalMs * 1_000_000) : null;
        ChromeBridgeStatus bridge = new ChromeBridgeStatus(active != null, watching.get() && active != null,
                active == null ? null : active.tabId(), active == null ? "" : active.url(),
                active == null ? "" : active.contentVersion(), lastHeartbeatAt, outboxCount,
                active == null ? "等待 BOSS 聊天页绑定" : "投递牛马 Chrome 扩展直连");
        return new WatchStatus(watching.get(), browserScanRunning || processingScan.get(), active == null ? "" : active.watchSessionId(), scanIntervalMs,
                lastScanAt, next, lastError, bridge, napCatGateway.isConnected(), autopilot == null || currentProfile == null || !autopilot.policy(currentProfile.getId()).enabled() || !"AUTO".equals(autopilot.policy(currentProfile.getId()).replyMode()) || !autopilot.blockers(currentProfile.getId()).isEmpty(),
                active == null ? null : active.profileId(), currentProfile == null ? null : currentProfile.getId(),
                currentProfile == null ? "" : currentProfile.getName(), profileGuard.isBlocked(),
                isReviewTrial()?"TRIAL_REVIEW":autopilot==null || currentProfile==null?"REVIEW":autopilot.policy(currentProfile.getId()).replyMode(),
                autopilot==null || currentProfile==null?List.of():dutyBlockers(currentProfile.getId()),
                autopilot==null || currentProfile==null?java.util.Map.of():autopilot.progressStatus(currentProfile.getId()),
                watching.get() && reviewReady, trialProposalIds.size(),
                active==null?"CHROME_BRIDGE":active.transport(),
                !watching.get()?backgroundBlocker.equals("USER_STOPPED")?"STOPPED":backgroundBlocker.isBlank()?"STOPPED":"PAUSED":
                        processingBackground.get()?"ANALYZING":browserScanRunning?"SCANNING":"WATCHING",
                backgroundBlocker,pageObservedAt==0?null:LocalDateTime.ofInstant(Instant.ofEpochMilli(pageObservedAt),ZoneId.systemDefault()),lastScanAt,
                active==null || active.binding()==null?"":active.binding().hostGeneration(),
                active==null || active.binding()==null?"":active.binding().pageDocumentId(),
                background==null || currentProfile==null?0:background.pending(currentProfile.getId()));
    }

    public String requireActiveWatchSession(Long profileId) {
        WatchSession active = session;
        if (!watching.get() || active == null) throw new IllegalStateException("请先在 BOSS 聊天页开始值守");
        if (!active.profileId().equals(profileId)) throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新开始值守");
        return active.watchSessionId();
    }

    public void assertActiveSession(Long profileId, String watchSessionId, int tabId) {
        WatchSession active = requireSession(watchSessionId, tabId);
        if (!active.profileId().equals(profileId)) {
            throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新开始值守");
        }
    }

    public <T> T withSession(Long profileId, String watchSessionId, int tabId, boolean completing,
                             java.util.function.Supplier<T> action) {
        return withSession(profileId,watchSessionId,tabId,completing,null,action);
    }

    public <T> T withSession(Long profileId,String watchSessionId,int tabId,boolean completing,
                             PageObservation observation,java.util.function.Supplier<T> action) {
        return profileGuard.locked(() -> {
            if (completing) {
                WatchSession active = session;
                if (active == null || !active.profileId().equals(profileId)
                        || !profileId.equals(profileService.getCurrentProfileId())
                        || !active.watchSessionId().equals(watchSessionId) || active.tabId() != tabId) {
                    throw new HrAssistantStore.StaleProposalException("发送结果不属于当前档案和值守会话");
                }
            } else {
                assertActiveSession(profileId, watchSessionId, tabId);
            }
            requirePageObservation(observation,false);
            return action.get();
        });
    }


    @Scheduled(fixedDelay = 5000)
    public void expireSendLeases() {
        profileGuard.locked(() -> { store.expireUnconfirmedLeases(); expirePageHeartbeat();return null; });
    }

    @Scheduled(cron = "0 15 3 * * *")
    public void purgeExpiredSensitiveData() {
        int deleted = store.purgeExpired();
        if(autopilot!=null) autopilot.purgeExpired();
        if(background!=null)background.purgeExpired();
        if (deleted > 0) log.info("已清理 {} 条过期 HR 消息正文", deleted);
    }

    private Long processCapture(Long profileId, HrAssistantStore.SettingsSecret settings, ChatCapture capture) {
        return processCapture(profileId,settings,capture,session);
    }

    private Long processCapture(Long profileId,HrAssistantStore.SettingsSecret settings,ChatCapture capture,WatchSession owner) {
        ChatSession chat = capture.session();
        boolean hosted=owner!=null && "CHROME_BACKGROUND".equals(owner.transport());
        boolean trial=owner!=null && owner.reviewLimit()==3;
        long conversationId = hosted?background.resolveConversation(profileId,capture):store.upsertConversation(profileId, chat);
        for (ChatMessage message : capture.messages()) store.saveMessage(conversationId, message, settings.retentionDays());
        // Full-list scans include conversations that the user has already answered.
        // Never draft a second response to an older inbound message in that case.
        if (!capture.messages().get(capture.messages().size() - 1).inbound()) {
            store.expireAnsweredProposals(conversationId);
            return null;
        }
        ChatMessage source = latestInboundForCurrentLastMessage(capture.messages(), chat.lastMessage());
        if (source == null) throw new IllegalStateException("最新入站消息与会话列表不一致，已保留 Outbox 并停止处理");
        String sourceFingerprint = hosted?background.sourceFingerprint(profileId,conversationId,capture,source):store.sourceFingerprint(conversationId, source);
        store.updateLastInbound(conversationId, sourceFingerprint);
        boolean reconsider=autopilot!=null && autopilot.policy(profileId).enabled() && "RECENT".equals(autopilot.policy(profileId).historyMode());
        if (trial ? store.prepareTrialSource(conversationId, sourceFingerprint) : hosted && capture.contextComplete()?
                store.prepareCompleteBackgroundSource(profileId,conversationId,sourceFingerprint,reconsider,autopilot.policy(profileId).version()):store.hasHandledSource(conversationId, sourceFingerprint,reconsider)) return null;

        if (autopilot != null) {
            if(trial || autopilot.historyAssessment(profileId,capture)==null) capture = autopilot.resolve(capture);
            autopilot.saveContext(conversationId, capture);
        }
        AiDraft draft;
        if(hosted && !capture.contextComplete()) {
            draft=new AiDraft(Classification.NEEDS_USER,"","聊天正文未完整读取，请本人核验",List.of("INCOMPLETE_CONTEXT"),List.of("完整聊天正文"),0);
        } else if(!trial && autopilot!=null && autopilot.historyAssessment(profileId,capture)!=null) {
            var assessment=autopilot.historyAssessment(profileId,capture);
            draft=new AiDraft(assessment.action().equals("HUMAN")?Classification.NEEDS_USER:Classification.NO_REPLY,"",assessment.reason(),List.of(),List.of(),1);
        } else if (autopilot == null && !"文本".equals(source.type())) {
            draft = new AiDraft(Classification.NEEDS_USER, "", "HR 发送了非文本消息，需要人工查看。",
                    List.of("NON_TEXT_MESSAGE"), List.of("请人工查看 " + source.type()), 1);
        } else {
            try {
                // The current ordered capture avoids mixing old, misclassified copies
                // with the corrected messages saved during historical recovery.
                draft = autopilot != null ? autopilot.generate(profileId, conversationId, settings.communicationProfile(), capture)
                        : draftService.generate(profileId, conversationId, settings.communicationProfile(), capture.messages());
            } catch (RuntimeException aiFailure) {
                draft = new AiDraft(Classification.NEEDS_USER, "", "AI 草稿生成失败，需要人工填写回复。",
                        List.of("AI_FAILURE"), List.of("请人工填写回复"), 0);
                events.emit("ai-draft-failed", java.util.Map.of("message", concise(aiFailure), "hrName", safe(chat.hrName())));
            }
        }
        if(hosted && (!watching.get() || session==null || !session.watchSessionId().equals(owner.watchSessionId()) || Thread.currentThread().isInterrupted()))throw new BackgroundInterrupted();
        long proposalId = store.createProposal(profileId, conversationId, sourceFingerprint, draft);
        if (trial && Set.of(Classification.NO_REPLY, Classification.REJECTION).contains(draft.classification())) {
            store.skip(profileId, proposalId);
            return null;
        }
        boolean notify;
        if (trial && autopilot != null) {
            autopilot.reviewTrial(profileId, proposalId, capture, draft);
            notify = true;
        } else notify = autopilot == null || autopilot.apply(profileId, proposalId, conversationId, capture, draft, owner.watchSessionId());
        ProposalView proposal = store.getProposalView(profileId, proposalId);
        events.emit("proposal-created", proposal);
        if (notify && settings.qqEnabled() && !napCatGateway.notifyProposal(proposal)) {
            events.emit("qq-notification-failed", java.util.Map.of("proposalId", proposal.id(), "message", "NapCat 未连接或 QQ 通知发送失败"));
        }
        return proposalId;
    }

    private ChatMessage latestInboundForCurrentLastMessage(List<ChatMessage> messages, String currentLastMessage) {
        for (int i = messages.size() - 1; i >= 0; i--) {
            ChatMessage message = messages.get(i);
            if (message.inbound() && (safe(currentLastMessage).isBlank() || compatible(message.text(), currentLastMessage))) return message;
        }
        return null;
    }

    private WatchSession requireSession(String watchSessionId, int tabId) {
        expirePageHeartbeat();
        WatchSession active = session;
        if (!watching.get() || active == null) throw new IllegalStateException("WATCH_SESSION_EXPIRED: BOSS HR 值守未启动或已暂停");
        if (!active.profileId().equals(profileService.getCurrentProfileId())) {
            throw new HrAssistantStore.StaleProposalException("当前人物档案已变化，请重新开始值守");
        }
        if (!active.watchSessionId().equals(safe(watchSessionId)) || active.tabId() != tabId) {
            throw new HrAssistantStore.StaleProposalException("值守会话或标签页已变化，拒绝处理旧请求");
        }
        return active;
    }

    private void validateCapture(ChatCapture capture) {
        if (capture == null) throw new IllegalArgumentException("HR 消息快照不能为空");
        requireNonBlank(capture.captureId(), "captureId");
        if (capture.session() == null) throw new IllegalArgumentException("HR 消息快照缺少会话身份");
        requireNonBlank(capture.session().uid(), "会话 UID");
        if (capture.messages().isEmpty()) throw new IllegalArgumentException("HR 消息快照缺少聊天记录");
    }

    private void validateChatTab(int tabId, String url, String contentVersion, String browserSessionId) {
        if (tabId <= 0) throw new IllegalArgumentException("BOSS 标签页 ID 无效");
        requireNonBlank(contentVersion, "Chrome 扩展内容脚本版本");
        requireNonBlank(browserSessionId, "浏览器值守会话 ID");
        try {
            URI parsed = URI.create(requireNonBlank(url, "BOSS 标签页地址"));
            String host = parsed.getHost() == null ? "" : parsed.getHost().toLowerCase();
            if (!"https".equalsIgnoreCase(parsed.getScheme())
                    || !(host.equals("zhipin.com") || host.endsWith(".zhipin.com"))
                    || !parsed.getPath().startsWith("/web/geek/chat")) {
                throw new IllegalArgumentException("请在当前 BOSS 求职者聊天页开始值守");
            }
        } catch (IllegalArgumentException invalidUrl) {
            if ("请在当前 BOSS 求职者聊天页开始值守".equals(invalidUrl.getMessage())) throw invalidUrl;
            throw new IllegalArgumentException("BOSS 标签页地址无效");
        }
    }

    private boolean compatible(String left, String right) {
        String a = safe(left).replaceAll("\\s+", "").toLowerCase();
        String b = safe(right).replaceAll("\\s+", "").toLowerCase();
        return !a.isBlank() && !b.isBlank() && (a.equals(b) || a.contains(b) || b.contains(a));
    }

    private String requireNonBlank(String value, String label) {
        String normalized = safe(value);
        if (normalized.isBlank()) throw new IllegalArgumentException(label + "不能为空");
        return normalized;
    }

    private String errorCode(Throwable error) {
        if (error instanceof HrAssistantStore.StaleProposalException) return "STALE_STATE";
        if (error instanceof IllegalArgumentException) return "INVALID_CAPTURE";
        return "CAPTURE_PROCESSING_FAILED";
    }

    private String concise(Throwable error) {
        String value = error.getMessage() == null ? error.getClass().getSimpleName() : error.getMessage();
        return value.length() <= 400 ? value : value.substring(0, 400);
    }

    private String concise(String value) {
        String safe = value == null ? "" : value;
        return safe.length() <= 400 ? safe : safe.substring(0, 400);
    }

    private String safe(String value) {
        return value == null ? "" : value.trim();
    }

    public boolean isBackground() {return session!=null && "CHROME_BACKGROUND".equals(session.transport());}
    public boolean isBackgroundForProfile(Long profile) {
        return isBackground() && session.profileId().equals(profile) && !"USER_STOPPED".equals(backgroundBlocker)
                && autopilot!=null && autopilot.policy(profile).enabled();
    }
    public java.util.List<java.util.Map<String,Object>> legacyAnchors() {
        if(!isBackground() || background==null)throw new IllegalStateException("请先绑定后台 Chrome");
        return background.legacyAnchors(session.profileId());
    }

    /** A fault can be reported from a frozen page. It never advances page liveness. */
    public WatchStatus reportFault(String watchSessionId,String generation,String account,String code) {
        return profileGuard.locked(()->{
            if(!isBackground() || !session.watchSessionId().equals(watchSessionId)
                    || !session.binding().hostGeneration().equals(generation)
                    || !normalize(session.binding().accountIdentity()).equals(normalize(account))
                    || !session.profileId().equals(profileService.getCurrentProfileId()))
                throw new HrAssistantStore.StaleProposalException("故障报告不属于当前后台托管");
            String error=safe(code).matches("[A-Z][A-Z_]{1,79}")?safe(code):"HOST_BLOCKED";
            boolean repeated=error.equals(backgroundBlocker) && !watching.get();
            watching.set(false);browserScanRunning=false;backgroundBlocker=error;
            lastError="后台聊天托管已暂停（"+error+"），请在工作台查看并处理";
            if(!repeated)napCatGateway.notifySystemFault(session.profileId(),lastError);
            return status();
        });
    }

    private boolean sameBinding(BackgroundBinding left,BackgroundBinding right) {
        return left!=null && right!=null && left.hostGeneration().equals(right.hostGeneration())
                && left.pageDocumentId().equals(right.pageDocumentId()) && normalize(left.accountIdentity()).equals(normalize(right.accountIdentity()));
    }
    private void validateBinding(BackgroundBinding binding) {
        if(binding==null)throw new IllegalArgumentException("后台托管缺少页面和账号绑定");
        requireNonBlank(binding.hostGeneration(),"托管 generation");requireNonBlank(binding.pageDocumentId(),"页面 documentId");
        requireNonBlank(binding.accountIdentity(),"BOSS 账号身份");requireNonBlank(binding.accountName(),"BOSS 登录姓名");
        // accountIdentity is an opaque page anchor (for example geek:<id>),
        // while accountName is the visible name confirmed by the user.
        validateObservationTime(binding.pageObservedAt());
    }
    private void requirePageObservation(PageObservation observation,boolean update) {
        if(!isBackground())return;
        BackgroundBinding binding=session.binding();
        if(observation==null || !safe(observation.hostGeneration()).equals(binding.hostGeneration())
                || !safe(observation.pageDocumentId()).equals(binding.pageDocumentId())
                || !normalize(observation.accountIdentity()).equals(normalize(binding.accountIdentity())))
            throw new HrAssistantStore.StaleProposalException("后台托管页面、generation 或账号已变化");
        validateObservationTime(observation.pageObservedAt());
        if(update) {
            if(observation.pageObservedAt()<pageObservedAt)throw new HrAssistantStore.StaleProposalException("页面心跳倒退，不能用后台计时器冒充页面在线");
            pageObservedAt=observation.pageObservedAt();
        }
    }
    private void validateObservationTime(long observed) {
        long now=System.currentTimeMillis();
        if(observed<=0 || observed>now+5000 || now-observed>120_000)throw new HrAssistantStore.StaleProposalException("页面观察已过期，请重新只读核验聊天页");
    }
    private void expirePageHeartbeat() {
        if(isBackground() && watching.get() && (pageObservedAt==0 || System.currentTimeMillis()-pageObservedAt>120_000)) {
            watching.set(false);browserScanRunning=false;backgroundBlocker="PAGE_HEARTBEAT_EXPIRED";
            lastError="真实聊天页面心跳已超过 120 秒，停止领取发送动作";
        }
    }
    private String normalize(String value) {return safe(value).replaceAll("\\s+","");}
    private static class BackgroundInterrupted extends IllegalStateException { }

    private record WatchSession(String watchSessionId, String browserSessionId, Long profileId,
                                int tabId, String url, String contentVersion, int reviewLimit,String transport,BackgroundBinding binding) {
    }
}
