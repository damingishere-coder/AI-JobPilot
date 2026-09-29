package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.*;
import com.getjobs.application.hr.HrVisualTypes;
import com.getjobs.application.hr.HrVisualTypes.*;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.PreDestroy;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

@Service
@RequiredArgsConstructor
public class HrVisualService {
    private final HrVisualStore visual;
    private final HrAssistantStore store;
    private final HrAutopilotStore policies;
    private final HrAutopilotService autopilot;
    private final HrVisualWorker worker;
    private final HrProfileGuard guard;
    private final ProfileService profiles;
    private final NapCatGateway qq;
    private final ObjectMapper json;
    private final TransactionTemplate transaction;
    private final HrVisualBatchStore batches;
    private final AtomicBoolean executing=new AtomicBoolean();
    private final ExecutorService executor=Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());

    @PostConstruct
    void initialize() {
        transaction.executeWithoutResult(tx->{
            for(Long id:visual.recover()) store.markFinal(id,ProposalStatus.SEND_UNKNOWN,"执行进程重启，无法确认发送结果，禁止自动重试");
            batches.recover();
        });
        guard.registerAdditionalBlocker(()->visual.busy() || executing.get() || batches.busy());
    }
    @PreDestroy void shutdown() {worker.cancel();executor.shutdownNow();}
    @Scheduled(cron="0 20 3 * * *")
    public void purgeSensitiveCopies() {
        guard.locked(()->{if(!executing.get())worker.purgeEvidence(visual.purgeSensitiveCopies());return null;});
    }

    public Map<String,Object> status(Long profile) {
        var runs=visual.runs(profile);
        var result=new LinkedHashMap<String,Object>(worker.availability());
        result.put("running",visual.busy());result.put("executing",executing.get());result.put("replyMode","REVIEW");
        result.put("intervalSeconds",5);result.put("napcatConnected",qq.isConnected());
        result.put("resumeRule",visual.resumeRule(profile));
        result.put("resumeResults",visual.resumeResults(profile));
        result.put("batch",batches.status(profile));result.put("observation",batches.observation(profile));
        if(!runs.isEmpty()) {
            Run run=runs.getFirst();result.put("runId",run.id());result.put("status",run.status());result.put("reason",run.reason());
            result.put("accountName",run.account());
            result.put("targets",visual.targets(run.id()).stream().map(t->{
                var m=new LinkedHashMap<String,Object>();m.put("id",t.id());m.put("hrName",t.seed().hrName());m.put("companyName",t.seed().companyName());
                m.put("status",t.status());m.put("reason",t.reason());m.put("proposalId",t.proposalId());
                m.put("previousAttempts",visual.previousAttempts(t.id()));
                m.put("steps",t.proposalId()==null?List.of():visual.steps(t.proposalId()));return m;
            }).toList());
        } else { result.put("status","IDLE");result.put("targets",List.of()); }
        return result;
    }
    public Object configureResumeRule(ResumeRuleRequest request) {
        return guard.locked(()->{
            if(request==null || !HrVisualTypes.PROTOCOL.equals(request.protocol()))throw new IllegalArgumentException("视觉协议不匹配");
            Long profile=profiles.getCurrentProfileId();
            if(!Objects.equals(profile,request.profileId()))throw new IllegalStateException("人物档案已变化");
            String account=Objects.requireNonNullElse(request.accountName(),"").strip();
            if(request.enabled()) {
                guard.requireChangeAllowed();
                if(!request.confirmed())throw new IllegalArgumentException("请明确授权仅在 HR 索要时自动分享 BOSS 简历");
                if(!Boolean.TRUE.equals(worker.availability().get("installed")))throw new IllegalStateException("视觉执行环境未安装");
                if(account.isBlank() || account.length()>60)throw new IllegalArgumentException("请填写 BOSS 登录姓名");
                if(!account.equals(profiles.getCurrentProfile().getName()) && !request.accountBindingConfirmed())throw new IllegalStateException("请确认 BOSS 账号与当前档案的绑定");
                if(policies.policy(profile).enabled() && "AUTO".equals(policies.policy(profile).replyMode()))throw new IllegalStateException("请先停止全自动文字托管");
            } else {
                if(account.isBlank() && Boolean.TRUE.equals(visual.resumeRule(profile).get("enabled")))account=visual.resumeAccount(profile);
                if(executing.get())worker.cancel();
            }
            visual.configureResumeRule(profile,request.enabled(),account);
            return status(profile);
        });
    }

    /** The independent rule only discovers/queues native resumes; it never approves a text. */
    private void scanResumeRule(Long profile) {
        if(!visual.resumeRuleActive(profile) || policies.policy(profile).paused())return;
        try {
            var rule=visual.resumeRule(profile);
            String account=visual.resumeAccount(profile);
            if(System.currentTimeMillis()-((Number)rule.get("last_scan")).longValue()>=60000) {
                var found=observe(profile,new LinkedHashMap<>(Map.of("operation","discover","account",account)));
                if(!found.path("ok").asBoolean())throw new IllegalStateException(found.path("detail").asText("联系人读取失败"));
                if(!found.path("contacts").isArray() || found.path("contacts").size()>100)throw new IllegalStateException("联系人列表不完整");
                visual.discoveredResumeContacts(profile,found.path("contacts"));return;
            }
            var candidate=visual.nextResumeContact(profile);if(candidate==null)return;
            String hr=candidate.path("hrName").asText(),company=candidate.path("companyName").asText();
            if(hr.isBlank() || company.isBlank())throw new IllegalStateException("联系人身份不完整");
            var inspect=new LinkedHashMap<String,Object>(Map.of("operation","inspect","account",account,"existingChatOnly",true,"target",Map.of("hrName",hr,"companyName",company)));
            var baseline=policies.visualBaseline(profile,hr,company);
            if(baseline!=null)inspect.put("contextBaseline",Map.of("hrName",hr,"companyName",company,"contextComplete",true,"messages",baseline.messages()));
            var observed=observe(profile,inspect);
            if(!observed.path("ok").asBoolean()) {
                String code=observed.path("code").asText();
                if(Set.of("HUMAN_TAKEOVER","FOCUS_CHANGED","DESKTOP_LOCKED","PLATFORM_CHECK","CANCELLED","ACCOUNT_UNVERIFIED","CHAT_TAB_MISSING").contains(code))
                    throw new IllegalStateException(observed.path("detail").asText("桌面已暂停"));
                visual.checkedResumeContact(profile,candidate);
                visual.resumeRuleState(profile,"WATCHING",hr+"："+observed.path("detail").asText("正文未完整读取，未发送"));return;
            }
            var descriptor=observed.path("resumeRequest");
            if(!descriptor.isObject() || !explicitResumeRequest(descriptor.path("text").asText())) {visual.checkedResumeContact(profile,candidate);return;}
            var temporary=new Target("","",0,null,new Seed("",hr,company,"","",true,true,null),"","");
            var fresh=decode(temporary,observed.path("capture"));
            if(!fresh.contextComplete() || fresh.messages().stream().noneMatch(m->m.inbound() && m.text().equals(descriptor.path("text").asText()) && m.time().equals(descriptor.path("time").asText())))
                throw new IllegalStateException("简历请求缺少完整可核验来源");
            guard.locked(()->transaction.execute(tx->{
                if(!visual.resumeRuleActive(profile) || !Objects.equals(profiles.getCurrentProfileId(),profile) || !Objects.equals(visual.resumeRule(profile).get("version"),rule.get("version")))return null;
                var session=store.resolveVisualSession(profile,fresh.session());
                long conversation=store.upsertVisualConversation(profile,session);
                String hash=visual.resumeRequestHash(profile,descriptor);
                if(policies.conversationHeld(conversation) || visual.resumeAttempted(profile,conversation,hash)) {
                    visual.checkedResumeContact(profile,candidate);visual.resumeRuleState(profile,"WATCHING",hr+"：已有处理或待核验记录，未重复发送");return null;
                }
                if(!observed.path("composer").asText().isBlank()) {
                    visual.checkedResumeContact(profile,candidate);visual.resumeRuleState(profile,"WATCHING",hr+"：保留现有草稿，简历未发送");return null;
                }
                var capture=new ChatCapture(fresh.captureId(),0,session,fresh.messages(),false,true);
                for(var m:fresh.messages())store.saveMessage(conversation,m,store.loadSettingsSecret(profile).retentionDays());
                var last=fresh.messages().stream().filter(ChatMessage::inbound).reduce((a,b)->b).orElseThrow();
                String fingerprint=store.sourceFingerprint(conversation,last);store.updateLastInbound(conversation,fingerprint);
                policies.context(conversation,capture);
                long proposal=store.createProposal(profile,conversation,fingerprint,new AiDraft(Classification.DOCUMENT_REQUEST,
                        "使用 BOSS 原生简历；优先同意 HR 的简历请求卡片", "本人已授权：HR 明确索要简历时直接发送；不附带文字回复",List.of(),List.of(),1));
                policies.decision(proposal,policies.policy(profile).version(),"RESUME_NATIVE","独立简历规则授权，文字仍逐条确认",false);policies.markTrial(proposal);
                String run=visual.create(profile,account,List.of(proposal),List.of(conversation),List.of(new Seed(session.uid(),hr,company,session.jobName(),"",true,true,capture)));
                visual.recordResumeAttempt(profile,conversation,hash,run,descriptor);
                var target=visual.targets(run).getFirst();
                String command=store.queueSendCommand(profile,proposal,1,"visual:"+run);visual.attachResumeOnly(command);
                visual.target(target.id(),proposal,"QUEUED","HR 明确索要简历；已按独立授权排队，尚未确认发送");
                visual.checkedResumeContact(profile,candidate);return null;
            }));
        } catch(RuntimeException e) {
            visual.resumeRuleState(profile,"PAUSED",safeError(e));
            qq.notifySystemFault(profile,"自动简历规则已暂停："+safeError(e));
        }
    }
    static boolean explicitResumeRequest(String value) {
        String s=normalize(value);
        return !s.matches("(?s).*(不要|不用|无需|不需要|暂不|别发|已收到|收到.*简历|看过.*简历|我发|我给|我提供|我的简历|你发过|您发过|简历已|身份证|银行卡|证件|链接|邮箱|微信).*") &&
                !s.matches("(?s).*((简历|履历)(解析|分析|优化|修改|制作|生成|功能|系统|筛选|匹配|模板|归档|要求)|(开发|研发).{0,12}(简历|履历)).*") &&
                s.matches("(?s).*((发|提供|给|传).{0,12}(简历|履历)|(想要|要(一|个|份)|需要(一|你|您)|看(看|一下|下)).{0,10}(简历|履历)|(简历|履历).{0,12}(发我|发给|给我|提供|发送|看看)).*");
    }
    public Object startBatch(BatchRequest request) {
        return guard.locked(()->transaction.execute(tx->{
            if(request==null || !HrVisualTypes.PROTOCOL.equals(request.protocol()))throw new IllegalArgumentException("视觉协议不匹配");
            Long profile=profiles.getCurrentProfileId();
            if(!Objects.equals(profile,request.profileId()))throw new IllegalStateException("当前档案已变化");
            if(request.requestKey()==null || !request.requestKey().matches("[a-zA-Z0-9-]{16,80}"))throw new IllegalArgumentException("启动请求标识无效");
            String hash=batches.requestHash(request);
            String existing=batches.existing(profile,request.requestKey(),hash);
            if(existing!=null){var replay=new LinkedHashMap<>(status(profile));replay.put("batch",batches.status(profile,existing));return replay;}
            guard.requireChangeAllowed();
            var previous=batches.latest(profile);
            if(previous!=null && "PAUSED".equals(previous.status()))throw new IllegalStateException("已有暂停批次，请恢复原批次，不能重新开页");
            if(visual.resumeRuleActive(profile))throw new IllegalStateException("请先关闭持续简历巡检，再启动单轮检查");
            if(policies.policy(profile).enabled())throw new IllegalStateException("请先停止原有持续值守，再启动单轮检查");
            if(!request.resumeSharingConfirmed())throw new IllegalArgumentException("请确认本轮仅向明确索要简历的 HR 分享 BOSS 原生简历");
            if(!Boolean.TRUE.equals(worker.availability().get("installed")))throw new IllegalStateException("视觉执行环境未安装");
            if(!store.loadSettingsSecret(profile).qqEnabled())throw new IllegalStateException("尚未配置 QQ 决策接收通道");
            String account=Objects.requireNonNullElse(request.accountName(),"").strip();
            if(account.isBlank() || account.length()>60)throw new IllegalArgumentException("BOSS 登录姓名无效");
            if(!account.equals(profiles.getCurrentProfile().getName()) && !request.accountBindingConfirmed())throw new IllegalStateException("请确认 BOSS 账号与档案绑定");
            String id=batches.create(profile,account,request.requestKey(),hash);
            for(long conversation:batches.exclusions(profile))addBatchIdentity(id,profile,conversation,"EXCLUDED");
            for(long conversation:batches.unknownConversations(profile))addBatchIdentity(id,profile,conversation,"ANCHOR");
            return status(profile);
        }));
    }
    private void addBatchIdentity(String batch,Long profile,long conversation,String kind) {
        var context=policies.context(profile,conversation);
        batches.add(batch,kind,json.valueToTree(Map.of("hrName",context.session().hrName(),"companyName",context.session().companyName(),"visualJob",context.session().jobName())),conversation);
    }
    public Object controlBatch(Long profile,String id,boolean resume) {
        return guard.locked(()->{
            var batch=batches.get(profile,id);
            if(resume) {
                if(executing.get() || visual.busy() || batches.busy())throw new IllegalStateException("请等待当前操作停止后恢复");
                if(!"PAUSED".equals(batch.status()))throw new IllegalStateException("批次并未暂停，不能重复恢复");
                if(!Objects.equals(profile,profiles.getCurrentProfileId()) || policies.policy(profile).enabled() || visual.resumeRuleActive(profile))throw new IllegalStateException("档案或其他值守状态已变化");
                if(Set.of("DISCOVER","POSITION_LIST").contains(batch.stage()))batches.resetCursor(id);
                if(!Set.of("BOOTSTRAP","ANCHORS","POSITION_LIST").contains(batch.stage())){
                    for(long conversation:batches.unknownConversations(profile))addBatchIdentity(id,profile,conversation,"ANCHOR");
                    batches.resetAnchors(id,batch.stage());
                }
                batches.state(id,"RUNNING",batch.stage().equals("BOOTSTRAP")?"BOOTSTRAP":Set.of("DISCOVER","POSITION_LIST").contains(batch.stage())?"POSITION_LIST":"ANCHORS","明确恢复；重新核验未知会话身份，沿用已有标签，不重新开页");
            } else {
                batches.state(id,"PAUSED",batch.stage(),"本人暂停；保留进度，提交中的动作仅核验回执");
                for(var item:batches.items(id))if(item.run()!=null && "RUNNING".equals(visual.run(profile,item.run()).status()))visual.state(item.run(),"PAUSED","批次已暂停");
                worker.cancel();
            }
            return status(profile);
        });
    }
    /** Reorder one discovered item within the existing authorization; never creates a new batch. */
    public Object prioritizeBatchItem(Long profile,String id,String itemId) {
        return prioritizeBatchItem(profile,id,itemId,false);
    }
    public Object recheckBatchItem(Long profile,String id,String itemId) {
        return prioritizeBatchItem(profile,id,itemId,true);
    }
    private Object prioritizeBatchItem(Long profile,String id,String itemId,boolean recheck) {
        return guard.locked(()->transaction.execute(tx->{
            var batch=batches.get(profile,id);
            if(!Objects.equals(profile,profiles.getCurrentProfileId()))throw new IllegalStateException("当前档案已变化");
            var item=batches.items(id).stream().filter(i->i.id().equals(itemId) && i.kind().equals("CONTACT")).findFirst()
                    .orElseThrow(()->new IllegalArgumentException("联系人不属于本轮"));
            // Repeated requests, including after completion, cannot requeue the same contact.
            boolean unreadFailure=recheck && batches.recheckable(item);
            if(!item.status().equals("PENDING") && !unreadFailure)return status(profile);
            if(!"PAUSED".equals(batch.status()) || !"DISCOVER".equals(batch.stage()) || executing.get() || visual.busy() || batches.busy())
                throw new IllegalStateException("请先暂停列表扫描并等待当前操作结束");
            if(policies.policy(profile).enabled() || visual.resumeRuleActive(profile))throw new IllegalStateException("其他值守已启用，请先停止");
            if(!item.contact().path("identityComplete").asBoolean() || batches.items(id).stream().anyMatch(i->i.kind().equals("EXCLUDED") && sameContact(i.contact(),item.contact())))
                throw new IllegalStateException("联系人身份不完整或属于本轮排除范围");
            for(long conversation:batches.unknownConversations(profile))addBatchIdentity(id,profile,conversation,"ANCHOR");
            batches.outcome(itemId,"PRIORITY_PENDING","优先核对本条；文字仍需 QQ 确认，之后继续本轮扫描");
            batches.resetCursor(id);
            batches.resetAnchors(id,"PROCESS_PRIORITY");
            batches.state(id,"RUNNING","POSITION_LIST","先定位列表顶部，再核验旧未知会话与优先联系人；不重新开页");
            return status(profile);
        }));
    }
    private JsonNode observe(Long profile,Map<String,Object> request) {
        return exchange(profile,request,null);
    }
    private static final class ObservationFailure extends IllegalStateException {
        private final String code;
        private ObservationFailure(JsonNode response) {
            super(response.path("detail").asText("读取失败"));
            code=response.path("code").asText("DRIVER_ERROR");
        }
    }
    private JsonNode exchange(Long profile,Map<String,Object> request,java.util.function.Function<JsonNode,Boolean> authorize) {
        var result=worker.exchange(request,authorize,event->batches.observation(profile,event));
        if(!result.path("ok").asBoolean())batches.observation(profile,json.valueToTree(Map.of("stage","OBSERVATION_FAILED","source","WINDOWS_VISUAL",
                "errorCode",result.path("code").asText("DRIVER_ERROR"),"detail",result.path("detail").asText("读取失败"),"observedAt",System.currentTimeMillis())));
        return result;
    }
    private void advanceBatch(Long profile) {
        var batch=batches.latest(profile);if(batch==null || !batches.active(profile))return;
        try {
            var request=new LinkedHashMap<String,Object>();request.put("account",batch.account());request.put("existingChatOnly",true);
            if(batch.stage().equals("BOOTSTRAP")) {
                request.put("operation","bootstrap");request.put("allowOpenOnce",batches.reserveOpen(batch.id()));
                var response=observe(profile,request);
                if(!response.path("ok").asBoolean())throw new ObservationFailure(response);
                if(batches.active(profile))batches.state(batch.id(),"RUNNING","ANCHORS","");return;
            }
            if(batch.stage().equals("POSITION_LIST")) {
                request.put("operation","discover_page");if(batch.cursor()!=null)request.put("cursor",batch.cursor());
                var response=observe(profile,request);
                if(!response.path("ok").asBoolean())throw new ObservationFailure(response);
                guard.locked(()->transaction.execute(tx->{
                    if(!batches.active(profile))return null;
                    if(!response.path("listTopVerified").asBoolean() && !"SEEKING_TOP".equals(response.path("coverage").asText()))
                        throw new IllegalStateException("列表顶部未核验，未开始身份检查");
                    if(response.path("listTopVerified").asBoolean()) {
                        batches.resetCursor(batch.id());batches.state(batch.id(),"RUNNING","ANCHORS","");
                    } else batches.checkpointTop(batch.id(),response);
                    return null;
                }));
                return;
            }
            if(batch.stage().equals("ANCHORS")) {
                var anchor=batches.items(batch.id()).stream().filter(i->i.kind().equals("ANCHOR") && i.status().equals("PENDING")).findFirst();
                if(anchor.isPresent()) {inspectBatchItem(batch,anchor.get());return;}
                batches.state(batch.id(),"RUNNING",batches.afterAnchors(batch.id()),"");
                for(var item:batches.items(batch.id()))if(item.run()!=null && "PAUSED".equals(visual.run(profile,item.run()).status()) && batches.allows(profile,item.run()))visual.state(item.run(),"RUNNING","");
                return;
            }
            if(batch.stage().equals("PROCESS_PRIORITY")) {
                var priority=batches.items(batch.id()).stream().filter(i->i.kind().equals("CONTACT") && i.status().equals("PRIORITY_PENDING")).findFirst();
                if(priority.isPresent()){inspectBatchItem(batch,priority.get());return;}
                // The scheduler drains queued sends before coming here. Sending can reorder the list.
                guard.locked(()->transaction.execute(tx->{
                    var current=batches.get(profile,batch.id());
                    if("RUNNING".equals(current.status()) && "PROCESS_PRIORITY".equals(current.stage()) && !visual.busy() &&
                            batches.items(batch.id()).stream().noneMatch(i->i.status().equals("PRIORITY_PENDING"))) {
                        batches.resetCursor(batch.id());
                        batches.state(batch.id(),"RUNNING","DISCOVER","优先会话已处理；重新收集列表以核验发送后的排序，保留逐项结果");
                    }
                    return null;
                }));
                return;
            }
            if(batch.stage().equals("DISCOVER")) {
                request.put("operation","discover_page");if(batch.cursor()!=null)request.put("cursor",batch.cursor());
                var response=observe(profile,request);
                if(!response.path("ok").asBoolean())throw new ObservationFailure(response);
                if(!response.path("contacts").isArray() || response.path("contacts").size()>100)throw new IllegalStateException("联系人分页响应不可核验");
                if(!batches.active(profile))return;
                if("SEEKING_TOP".equals(response.path("coverage").asText())){batches.checkpointTop(batch.id(),response);return;}
                batches.page(batch.id(),response);
                if(response.path("coverageComplete").asBoolean()) {
                    if(batches.confirmDiscovery(batch.id()))batches.state(batch.id(),"RUNNING","PROCESS",batches.get(profile,batch.id()).coverage()?"两次列表枚举一致，已确认末尾":"列表覆盖未完成：枚举不一致或发生重排");
                } else if(batches.discoveryLimit(batch.id()))batches.state(batch.id(),"RUNNING","PROCESS","列表覆盖未完成：滚动无进展或达到本轮页数上限");
                return;
            }
            var pending=batches.items(batch.id()).stream().filter(i->i.kind().equals("CONTACT") && i.status().equals("PENDING")).findFirst();
            if(pending.isPresent()){inspectBatchItem(batch,pending.get());return;}
            boolean complete=batch.coverage() && batches.items(batch.id()).stream().noneMatch(i->Set.of("BLOCKED","DATE_UNKNOWN","READ_FAILED").contains(i.status()));
            batches.state(batch.id(),complete?"FINISHED":"INCOMPLETE","DONE",complete?"本轮扫描完成，待确认卡片继续保留；未开启持续巡检":"本轮停止；存在未核验会话或未完成的列表范围，请查看明细");
            policies.notification(profile,"visual-batch-final:"+batch.id(),"BOSS 单轮检查已停止。"+(complete?"已核验列表覆盖。":"存在未完成范围，不能认定全部已检查。")+"\n"+batches.status(profile).get("discovered")+" 个联系人，"+batches.status(profile).get("pendingReview")+" 条待确认；发送结果请以各卡片真实回执为准。");
        }catch(RuntimeException error) {
            batches.state(batch.id(),"PAUSED",batch.stage(),safeError(error));
            batches.observation(profile,json.valueToTree(Map.of("stage",error instanceof ObservationFailure?"OBSERVATION_FAILED":"EXECUTOR_ERROR",
                    "errorCode",error instanceof ObservationFailure failure?failure.code:"EXECUTOR_ERROR",
                    "source","WINDOWS_VISUAL","detail",safeError(error),"observedAt",System.currentTimeMillis())));
            policies.notification(profile,"visual-batch-blocked:"+batch.id()+":"+batch.stage(),"BOSS 单轮检查已暂停："+safeError(error)+"。没有刷新或重新开页。");
        }
    }
    private void inspectBatchItem(HrVisualBatchStore.Batch batch,HrVisualBatchStore.Item item) {
        Long profile=batch.profile();var contact=item.contact();
        if(item.kind().equals("CONTACT")) {
            if(!contact.path("identityComplete").asBoolean()) {batches.outcome(item.id(),"BLOCKED","姓名或公司截断，不能可靠定位");return;}
            if(batches.items(batch.id()).stream().anyMatch(i->i.kind().equals("EXCLUDED") && sameContact(i.contact(),contact))) {
                batches.outcome(item.id(),"EXCLUDED","此前测试会话，本轮不再发送");return;
            }
        }
        var request=new LinkedHashMap<String,Object>(Map.of("operation","inspect","account",batch.account(),"existingChatOnly",true,"target",contact));
        var baseline=policies.visualBaseline(profile,contact.path("hrName").asText(),contact.path("companyName").asText());
        if(baseline!=null)request.put("contextBaseline",Map.of("hrName",contact.path("hrName").asText(),"companyName",contact.path("companyName").asText(),"contextComplete",true,"messages",baseline.messages()));
        var response=observe(profile,request);
        if(!batches.active(profile))return;
        if(!response.path("ok").asBoolean()) {
            if(Set.of("HUMAN_TAKEOVER","FOCUS_CHANGED","DESKTOP_LOCKED","PLATFORM_CHECK","CANCELLED","CHAT_TAB_MISSING","ACCOUNT_UNVERIFIED","LIST_NOT_READY").contains(response.path("code").asText()))throw new ObservationFailure(response);
            batches.outcome(item.id(),"READ_FAILED",response.path("detail").asText("正文未核验"));return;
        }
        var seed=new Seed("",contact.path("hrName").asText(),contact.path("companyName").asText(),contact.path("visualJob").asText(),"",false,false,null);
        var fresh=decode(new Target("","",0,null,seed,"",""),response.path("capture"));
        if(!fresh.contextComplete() || fresh.messages().isEmpty()){batches.outcome(item.id(),"READ_FAILED","完整消息轮次未核验");return;}
        batches.observed(item.id());
        if(item.kind().equals("ANCHOR")) {
            boolean verified=baseline!=null && sourceRound(baseline.messages()).equals(sourceRound(fresh.messages())) &&
                    normalize(baseline.session().jobName()).equals(normalize(fresh.session().jobName()));
            batches.outcome(item.id(),verified?"VERIFIED":"BLOCKED",verified?"已只读锁定旧未知会话身份；原发送状态保持冻结":"旧未知会话无法可靠关联，未解除身份保护");return;
        }
        if(!response.path("composer").asText().isBlank()){batches.outcome(item.id(),"BLOCKED","保留人工草稿，未提交");return;}
        var last=fresh.messages().stream().filter(ChatMessage::inbound).reduce((a,b)->b).orElse(null);
        if(last==null){batches.outcome(item.id(),"SKIPPED","没有可核验的 HR 消息");return;}
        var today=java.time.LocalDate.now(java.time.ZoneId.of("Asia/Shanghai"));
        var date=HrDutyHistory.date(last.time(),today);
        if(date==null || date.isAfter(today)){batches.outcome(item.id(),"DATE_UNKNOWN","HR 消息日期无法确认，未发送");return;}
        if(date.isBefore(today.minusDays(30))){batches.outcome(item.id(),"SKIPPED","超出最近 30 天");return;}
        var resume=response.path("resumeRequest");boolean isResume=resume.isObject() && explicitResumeRequest(resume.path("text").asText());
        if(!isResume && !fresh.messages().getLast().inbound()){batches.outcome(item.id(),"SKIPPED","最后一条已是本人回复");return;}
        ChatSession session;
        try {session=store.resolveVisualSession(profile,fresh.session(),batches.verifiedAnchors(batch.id()));}
        catch(IllegalStateException error) {
            batches.outcome(item.id(),"BLOCKED",safeError(error));
            policies.notification(profile,"visual-batch-held:"+item.id(),"【待核验，不可执行】"+seed.hrName()+" · "+seed.companyName()+"\nHR："+last.text()+"\n"+safeError(error));return;
        }
        long conversation=store.upsertVisualConversation(profile,session);
        if(policies.conversationHeld(conversation)){batches.outcome(item.id(),"BLOCKED","会话已有未知或阻塞发送记录");return;}
        String fingerprint=store.sourceFingerprint(conversation,last);
        if(store.hasHandledSource(conversation,fingerprint,true)){batches.outcome(item.id(),"SKIPPED","相同来源已有记录，未生成重复卡片或发送");return;}
        var capture=new ChatCapture(fresh.captureId(),0,session,fresh.messages(),false,true);
        AiDraft draft;
        if(isResume)draft=new AiDraft(Classification.DOCUMENT_REQUEST,"使用 BOSS 原生简历","本轮授权：HR 明确索要简历；不附带文字",List.of(),List.of(),1);
        else {
            try {draft=autopilot.generate(profile,conversation,store.loadSettingsSecret(profile).communicationProfile(),capture);
                var audit=autopilot.assess(profile,conversation,capture,draft);
                draft=new AiDraft(draft.classification(),draft.replyText(),audit.reason(),draft.riskTags(),draft.missingFacts(),draft.confidence());
            }catch(RuntimeException error){draft=new AiDraft(Classification.NEEDS_USER,"","AI 生成或审核失败，需要本人填写",List.of("AI_FAILURE"),List.of(),0);}
        }
        if(draft.classification()==Classification.NO_REPLY || draft.classification()==Classification.REJECTION){batches.outcome(item.id(),"SKIPPED","已结束或无需回复");return;}
        AiDraft finalDraft=draft;
        guard.locked(()->transaction.execute(tx->{
            if(!batches.active(profile) || visual.busy() || !Objects.equals(profile,profiles.getCurrentProfileId()))return null;
            if(store.hasHandledSource(conversation,fingerprint,true))return null;
            for(var message:capture.messages())store.saveMessage(conversation,message,store.loadSettingsSecret(profile).retentionDays());
            store.updateLastInbound(conversation,fingerprint);policies.context(conversation,capture);
            long proposal=store.createProposal(profile,conversation,fingerprint,finalDraft);
            policies.decision(proposal,policies.policy(profile).version(),isResume?"RESUME_NATIVE":"TEXT","单轮托管：简历独立授权，文字逐条 QQ 确认",false);policies.markTrial(proposal);
            String run=visual.create(profile,batch.account(),List.of(proposal),List.of(conversation),List.of(new Seed(session.uid(),session.hrName(),session.companyName(),session.jobName(),"",false,false,capture)));
            visual.reserveOpen(run);batches.link(item.id(),conversation,run,isResume?resume:null);
            var target=visual.targets(run).getFirst();
            if(isResume) {
                String command=store.queueSendCommand(profile,proposal,1,"visual:"+run);visual.attachResumeOnly(command);
                visual.target(target.id(),proposal,"QUEUED","本轮明确索要简历，已排队；尚未确认发送");
            } else {visual.target(target.id(),proposal,"REVIEW_REQUIRED","建议已保存，等待 QQ 确认");visual.state(run,"WAITING_REVIEW","等待本条确认；不阻塞扫描其他联系人");}
            return proposal;
        }));
        if(!isResume)for(var linked:batches.items(batch.id()))if(linked.id().equals(item.id()) && linked.run()!=null)qq.notifyProposal(store.getProposalView(profile,visual.targets(linked.run()).getFirst().proposalId()));
    }
    private static boolean sameContact(JsonNode a,JsonNode b){return normalize(a.path("hrName").asText()).equals(normalize(b.path("hrName").asText())) && normalize(a.path("companyName").asText()).equals(normalize(b.path("companyName").asText()));}

    public Object start(StartRequest request) {
        return guard.locked(()->transaction.execute(tx->{
            if(request==null || !HrVisualTypes.PROTOCOL.equals(request.protocol())) throw new IllegalArgumentException("视觉协议不匹配，请刷新工作台");
            if(!Objects.equals(request.profileId(),profiles.getCurrentProfileId())) throw new IllegalStateException("当前人物档案已变化");
            guard.requireChangeAllowed();
            if(request.targets()==null || request.targets().size()!=3) throw new IllegalArgumentException("本次仅允许三个指定会话");
            if(!Boolean.TRUE.equals(worker.availability().get("installed"))) throw new IllegalStateException("请先安装视觉执行环境");
            var settings=store.loadSettingsSecret(request.profileId());
            if(!settings.qqEnabled() || !qq.isConnected()) throw new IllegalStateException("请先连接 QQ 决策通道");
            if(policies.policy(request.profileId()).enabled() && "AUTO".equals(policies.policy(request.profileId()).replyMode()))
                throw new IllegalStateException("请先停止全自动托管");
            var seeds=new ArrayList<Seed>();var sources=new ArrayList<Long>();var conversations=new ArrayList<Long>();
            for(TargetRequest target:request.targets()) {
                var p=store.requireProposal(request.profileId(),target.proposalId());
                if(p.version()!=target.expectedVersion()) throw new IllegalStateException("原卡片版本已变化，请重新选择");
                if(Set.of(ProposalStatus.SENT_CONFIRMED,ProposalStatus.SEND_UNKNOWN,ProposalStatus.SENDING,ProposalStatus.APPROVED,ProposalStatus.SKIPPED,ProposalStatus.BLOCKED).contains(p.status()))
                    throw new IllegalStateException("所选会话已处理或有未决发送，不能重新执行");
                if(conversations.contains(p.conversationId())) throw new IllegalArgumentException("三个会话不能重复");
                if(policies.conversationHeld(p.conversationId())) throw new IllegalStateException("会话有未知或阻塞记录，请先核验");
                ChatCapture expected=policies.context(request.profileId(),p.conversationId());
                if(expected.messages().isEmpty()) throw new IllegalArgumentException("原卡片缺少消息依据");
                String draft=Objects.requireNonNullElse(target.draft(),"").strip();
                if(target.approved() && (draft.isBlank() || draft.length()>2000)) throw new IllegalArgumentException("已批准正文为空或过长");
                if(target.approved() && !"USER_CONFIRMED_TEST".equals(target.approvalSource()))
                    throw new IllegalArgumentException("仅本次明确批准的测试正文可承接授权，普通启动必须经 QQ 确认");
                if(target.sendResume() && (!target.resumeSharingConfirmed() || !target.approved()))
                    throw new IllegalArgumentException("原生简历必须获得针对本次会话的独立分享确认");
                String job=p.jobName().isBlank()?Objects.requireNonNullElse(target.expectedJobName(),""):p.jobName();
                if(target.approved() && job.isBlank()) throw new IllegalArgumentException("已批准测试必须给出核对后的岗位名称");
                seeds.add(new Seed(p.uid(),p.hrName(),p.companyName(),job,draft,target.sendResume(),target.approved(),expected));
                sources.add(p.id());conversations.add(p.conversationId());
            }
            String profileName=profiles.getCurrentProfile().getName();
            String account=Objects.requireNonNullElse(request.accountName(),profileName).strip();
            if(account.isBlank() || account.length()>60) throw new IllegalArgumentException("BOSS 登录姓名为空或过长");
            if(!account.equals(profileName) && !request.accountBindingConfirmed()) throw new IllegalStateException("BOSS 登录姓名与档案不同，请本人确认账号绑定");
            visual.create(request.profileId(),account,sources,conversations,seeds);
            return status(request.profileId());
        }));
    }
    public Object control(Long profile,String id,boolean resume) {
        return guard.locked(()->{
            Run r=visual.run(profile,id);
            if(resume) {
                if(executing.get()) throw new IllegalStateException("正在核验上一操作，请稍后恢复");
                if(!Set.of("PAUSED","BLOCKED").contains(r.status())) throw new IllegalStateException("该测试不能恢复");
                visual.releaseIdleParentLeases(id);
                guard.requireChangeAllowed();
                if(policies.policy(profile).enabled()) policies.pause(profile,false);
                visual.state(id,"RUNNING","");
            } else {
                if(visual.resumeRuleActive(profile))visual.resumeRuleState(profile,"PAUSED","本人暂停视觉操作");
                visual.state(id,executing.get()?"STOPPING":"PAUSED","本人暂停，正在执行的动作仍核验回执");worker.cancel();
            }
            return status(profile);
        });
    }
    /** Explicit human review only. Old unknown/blocked receipts are never reset or deleted. */
    public Object reconfirm(Long profile,String runId,String targetId,ReconfirmRequest review) {
        return guard.locked(()->{
            if(review==null || !review.confirmed()) throw new IllegalArgumentException("必须由本人重新确认原文");
            if(!Objects.equals(profile,profiles.getCurrentProfileId())) throw new IllegalStateException("当前档案已变化");
            Run run=visual.run(profile,runId);
            if(!Set.of("PAUSED","BLOCKED","COMPLETED").contains(run.status()) || executing.get() || visual.busy())
                throw new IllegalStateException("请先暂停测试并等待执行器退出");
            guard.requireChangeAllowed();
            Target target=visual.targets(runId).stream().filter(t->t.id().equals(targetId)).findFirst().orElseThrow();
            if(!Objects.equals(target.proposalId(),review.proposalId())) throw new IllegalStateException("该次确认已处理或已被新版本替代");
            var old=store.requireProposal(profile,review.proposalId());
            var previousSteps=visual.steps(old.id());
            boolean resumeOnly=previousSteps.size()==1 && "RESUME_NATIVE".equals(previousSteps.getFirst().get("action_type"));
            if(!Set.of(ProposalStatus.BLOCKED,ProposalStatus.SEND_UNKNOWN,ProposalStatus.EXPIRED).contains(old.status()) ||
                    old.version()!=review.expectedVersion() || old.draft().isBlank() || old.draft().length()>2000 || !old.draft().equals(review.draft()))
                throw new IllegalStateException("只能重新确认当前失败版本的完整原文");
            if((old.status()==ProposalStatus.SEND_UNKNOWN || visual.previousUnknownAttempt(target.id())) && !review.possibleDuplicateAccepted())
                throw new IllegalArgumentException("前次结果未知，必须本人核验并明确重新授权，不能自动重试");
            if(visual.hasOtherLaterAttempt(target.conversationId(),old.id()) || visual.steps(old.id()).stream().anyMatch(s->"SENT_CONFIRMED".equals(s.get("status"))))
                throw new IllegalStateException("已有其他发送或部分成功步骤，不能重发文字");
            if(!executing.compareAndSet(false,true)) throw new IllegalStateException("桌面仍在执行");
            try {
                JsonNode observed=observe(profile,request(run,target,"inspect"));
                if(!observed.path("ok").asBoolean()) throw new IllegalStateException(observed.path("detail").asText("复核失败"));
                var fresh=decode(target,observed.path("capture"));
                var expectedMessages=target.seed().expected().messages();
                var existingOwn=resumeOnly?expectedMessages.subList(expectedMessages.size()-trailingOwnCount(expectedMessages),expectedMessages.size()).stream().map(ChatMessage::text).toList():List.<String>of();
                if(!fresh.contextComplete() || !safeRound(fresh.messages(),expectedMessages,existingOwn))
                    throw new IllegalStateException("本轮消息已变化或出现本人回复，不能按原文重新发送");
                if(resumeOnly) {
                    JsonNode expectedRequest=batches.resumeRequest(runId);
                    if(expectedRequest==null && visual.isResumeRuleRun(runId))expectedRequest=visual.resumeRequest(runId);
                    if(expectedRequest==null || !expectedRequest.equals(observed.path("resumeRequest")))
                        throw new IllegalStateException("原生简历请求已失效或发生变化，未重新排队");
                }
                String composer=observed.path("composer").asText();
                if(!composer.isBlank() && (resumeOnly || !normalize(composer).equals(normalize(old.draft()))))
                    throw new IllegalStateException("输入框有不同的人工草稿，未覆盖");
                return transaction.execute(tx->{
                    autopilot.saveContext(target.conversationId(),fresh);
                    long next=store.createProposal(profile,target.conversationId(),old.sourceFingerprint(),
                            new AiDraft(resumeOnly?Classification.DOCUMENT_REQUEST:Classification.REPLY,old.draft(),"本人复核后重新确认；前次 #"+old.id()+" 的结果与证据保留",List.of(),List.of(),1));
                    policies.decision(next,policies.policy(profile).version(),resumeOnly?"RESUME_NATIVE":"TEXT","人工重新确认，保留原始记录",false);policies.markTrial(next);
                    visual.recordReconfirmation(target.id(),old.id(),next);
                    var s=target.seed();visual.seed(target.id(),new Seed(s.uid(),s.hrName(),s.companyName(),s.jobName(),old.draft(),s.sendResume(),true,fresh));
                    String command=store.queueSendCommand(profile,next,1,"visual:"+run.id());
                    if(resumeOnly)visual.attachResumeOnly(command);else visual.attach(command,s.sendResume());
                    visual.target(target.id(),next,"QUEUED","本人重新确认，原记录保留；等待恢复测试");
                    visual.state(run.id(),"PAUSED","复核完成，等待恢复测试");
                    return status(profile);
                });
            } finally {executing.set(false);}
        });
    }
    /** Read-only browser reconciliation: never authorizes or queues another submission. */
    public Object reconcile(Long profile,String runId,String targetId) {
        return guard.locked(()->{
            if(!Objects.equals(profile,profiles.getCurrentProfileId()))throw new IllegalStateException("当前档案已变化");
            Run run=visual.run(profile,runId);
            if(!Set.of("PAUSED","BLOCKED","COMPLETED").contains(run.status()) || executing.get() || visual.busy())
                throw new IllegalStateException("请先暂停并等待执行器退出");
            guard.requireChangeAllowed();
            Target target=visual.targets(runId).stream().filter(t->t.id().equals(targetId)).findFirst().orElseThrow();
            var proposal=store.requireProposal(profile,target.proposalId());
            if(proposal.status()!=ProposalStatus.SEND_UNKNOWN || !target.status().equals("SEND_UNKNOWN"))throw new IllegalStateException("当前没有待核验的未知步骤");
            var steps=visual.steps(proposal.id());
            var unknown=steps.stream().filter(s->"SEND_UNKNOWN".equals(s.get("status"))).toList();
            if(unknown.size()!=1)throw new IllegalStateException("未知步骤不能唯一确认");
            var step=unknown.getFirst();String stepId=(String)step.get("id"),action=(String)step.get("action_type");
            JsonNode original=visual.stepEvidence(stepId);
            if(original==null || !(original.path("submitted").asBoolean() || original.path("submissionAuthorized").asBoolean()) || !original.path("before").path("contextComplete").asBoolean())
                throw new IllegalStateException("缺少可比对的完整发送前证据；保持未知，未重发");
            var before=decode(target,original.path("before"));
            var own=before.messages().subList(before.messages().size()-trailingOwnCount(before.messages()),before.messages().size()).stream().map(ChatMessage::text).toList();
            var expectedOwn=new ArrayList<>(own);if(action.equals("TEXT"))expectedOwn.add(proposal.draft());
            var req=request(run,target,"reconcile");req.put("receiptBefore",original.path("before"));req.put("stepId",stepId);req.put("actionType",action);req.put("draft",proposal.draft());
            if(!executing.compareAndSet(false,true))throw new IllegalStateException("桌面仍在执行");
            try {
                JsonNode result=observe(profile,req);
                if(!result.path("ok").asBoolean() || !"SENT_CONFIRMED".equals(result.path("outcome").asText()))throw new IllegalStateException(result.path("detail").asText("回执仍未确认，未重发"));
                var after=decode(target,result.path("capture"));
                if(!after.contextComplete() || !receipt(after.messages(),before.messages(),expectedOwn,action))throw new IllegalStateException("新增本人消息与批准内容不匹配，保持未知");
                for(JsonNode m:result.path("capture").path("messages"))if(m.path("failed").asBoolean() || m.path("pending").asBoolean())throw new IllegalStateException("消息仍在发送或显示失败，保持未知");
                return transaction.execute(tx->{
                    visual.reconcileStep(stepId,result);
                    boolean complete=visual.steps(proposal.id()).stream().allMatch(s->"SENT_CONFIRMED".equals(s.get("status")));
                    if(complete) {
                        visual.completeParent(visual.commandId(stepId),"SENT_CONFIRMED");
                        store.markFinal(proposal.id(),ProposalStatus.SENT_CONFIRMED,"只读复核已确认新增本人消息；原未知记录保留；没有再次提交");
                    } else {
                        visual.resumeRemaining(visual.commandId(stepId));
                        store.transition(proposal.id(),ProposalStatus.SEND_UNKNOWN,ProposalStatus.APPROVED);
                        visual.state(runId,"PAUSED","文字回执已确认；恢复时仅处理剩余未提交的已批准步骤");
                    }
                    visual.target(targetId,null,complete?"SENT_CONFIRMED":"PARTIAL",complete?"只读复核已确认发送，没有再次提交":"文字已确认；等待恢复其余未提交步骤，不重发文字");
                    for(var message:after.messages())store.saveMessage(target.conversationId(),message,store.loadSettingsSecret(profile).retentionDays());
                    policies.notification(profile,"visual-reconciled:"+stepId,target.seed().companyName()+" / "+target.seed().hrName()+"\n"+
                            (action.equals("TEXT")?"文字":"原生简历")+"回执已由只读复核确认，没有再次提交；原未知记录已保留。\n"+
                            (complete?"全部批准步骤已完成。":"本轮保持暂停，恢复后仅处理剩余已批准的未提交步骤。"));
                    return status(profile);
                });
            } finally {executing.set(false);}
        });
    }
    private static int trailingOwnCount(List<ChatMessage> messages) {
        int n=0;for(int i=messages.size()-1;i>=0 && !messages.get(i).inbound();i--)n++;return n;
    }
    public boolean owns(Long profile,long proposal) {return visual.owner(profile,proposal)!=null;}
    public boolean qqControl(Long profile,boolean resume) {
        var batch=batches.latest(profile);
        if(batch!=null && (batches.active(profile) || (resume && "PAUSED".equals(batch.status())))) {controlBatch(profile,batch.id(),resume);return true;}
        if(!resume && visual.resumeRuleActive(profile)) {visual.resumeRuleState(profile,"PAUSED","本人通过 QQ 暂停");if(executing.get())worker.cancel();}
        var runs=visual.runs(profile);
        if(!runs.isEmpty() && (Set.of("RUNNING","STOPPING").contains(runs.getFirst().status()) ||
                (resume && Set.of("PAUSED","BLOCKED").contains(runs.getFirst().status())))) {
            control(profile,runs.getFirst().id(),resume);return true;
        }
        return false;
    }
    public ProposalView queue(Long profile,long proposal,int version) {
        return guard.locked(()->transaction.execute(tx->{
            Target t=Objects.requireNonNull(visual.owner(profile,proposal),"视觉任务不存在");
            if(!batches.allows(profile,t.runId()))throw new IllegalStateException("本轮已暂停，请先明确恢复");
            if(batches.owner(t.runId())!=null && "WAITING_REVIEW".equals(visual.run(profile,t.runId()).status()))visual.state(t.runId(),"RUNNING","本人已确认本条，未重新启动扫描");
            if(!visual.run(profile,t.runId()).status().equals("RUNNING") || legacyPaused(profile,t.runId())) throw new IllegalStateException("视觉测试已暂停，请先恢复");
            if(!t.status().equals("REVIEW_REQUIRED")) throw new IllegalStateException("该任务已排队或已处理，未重复发送");
            String command=store.queueSendCommand(profile,proposal,version,"visual:"+t.runId());
            visual.attach(command,t.seed().sendResume());visual.target(t.id(),proposal,"QUEUED","本人已确认，等待本机桌面");
            return store.getProposalView(profile,proposal);
        }));
    }
    public void assertEditable(Long profile,long proposal) {
        Target t=visual.owner(profile,proposal);
        if(t!=null && !t.status().equals("REVIEW_REQUIRED")) throw new IllegalStateException("该视觉任务已排队或已处理，不能修改或跳过");
    }
    public void skipped(Long profile,long proposal) {Target t=visual.owner(profile,proposal);if(t!=null)visual.target(t.id(),proposal,"SKIPPED","本人跳过");}

    @Scheduled(fixedDelay=1000)
    public void tick() {
        Long profile=profiles.getCurrentProfileIdOrNull();
        if(profile==null || (!visual.busy() && !visual.resumeRuleActive(profile) && !batches.active(profile)) || !executing.compareAndSet(false,true)) return;
        executor.submit(()->{
            try { if(visual.busy())advance(); else if(batches.active(profile))advanceBatch(profile); else scanResumeRule(profile); }
            finally { executing.set(false); }
        });
    }
    private void advance() {
        Long profile=profiles.getCurrentProfileIdOrNull();if(profile==null)return;
        for(Run run:visual.runs(profile)) {
            if(run.status().equals("STOPPING")) {visual.state(run.id(),"PAUSED",run.reason());continue;}
            if(!run.status().equals("RUNNING"))continue;
            if(!batches.allows(profile,run.id())) {visual.state(run.id(),"PAUSED","批次已暂停");continue;}
            if(visual.isResumeRuleRun(run.id()) && !visual.resumeRuleAuthorized(profile,run.id())) {
                visual.state(run.id(),"PAUSED","简历规则已暂停、关闭或授权版本变化");continue;
            }
            if(legacyPaused(profile,run.id()))return;
            try {
                visual.expire(run.id());
                var targets=visual.targets(run.id());
                // All three identities and conversations must be inspected before the first real send.
                var pending=targets.stream().filter(t->t.status().equals("PENDING_CAPTURE")).findFirst();
                if(pending.isPresent()){capture(run,pending.get());return;}
                var queued=targets.stream().filter(t->Set.of("QUEUED","PARTIAL").contains(t.status())).findFirst();
                if(queued.isPresent()){send(run,queued.get());return;}
                if(targets.stream().allMatch(t->Set.of("SENT_CONFIRMED","SKIPPED","STALE","SEND_UNKNOWN","BLOCKED").contains(t.status())))
                    visual.state(run.id(),"COMPLETED","本轮处理结束，请逐项查看真实结果");
            }catch(RuntimeException e){
                visual.state(run.id(),"BLOCKED",safeError(e));qq.notifySystemFault(profile,"视觉测试已停止："+safeError(e));
            }
            return;
        }
    }
    private Map<String,Object> request(Run run,Target target,String operation) {
        var r=new LinkedHashMap<String,Object>();r.put("operation",operation);r.put("account",run.account());
        r.put("target",Map.of("hrName",target.seed().hrName(),"companyName",target.seed().companyName(),"jobName",target.seed().jobName(),
                "visualJob",target.seed().jobName()));
        r.put("existingChatOnly",true);
        if(operation.equals("inspect") && batches.owner(run.id())==null)r.put("allowOpenOnce",visual.reserveOpen(run.id()));
        return r;
    }
    private void capture(Run run,Target target) {
        JsonNode response=observe(run.profileId(),request(run,target,"inspect"));
        if(!response.path("ok").asBoolean())throw new IllegalStateException(response.path("detail").asText("会话读取失败"));
        ChatCapture capture=decode(target,response.path("capture"));
        if(!capture.contextComplete() || capture.messages().isEmpty())throw new IllegalStateException("聊天正文或本轮上下文未完整读取");
        for(var message:capture.messages())store.saveMessage(target.conversationId(),message,store.loadSettingsSecret(run.profileId()).retentionDays());
        if(!capture.messages().getLast().inbound()) {
            store.expireAnsweredProposals(target.conversationId());
            visual.target(target.id(),null,"SKIPPED","最后一条已是本人回复，旧卡片失效，未补发");return;
        }
        String fingerprint=store.sourceFingerprint(target.conversationId(),capture.messages().getLast());
        if(store.prepareTrialSource(target.conversationId(),fingerprint)) {visual.target(target.id(),null,"SKIPPED","相同来源已处理或有待核验记录");return;}
        store.updateLastInbound(target.conversationId(),fingerprint);autopilot.saveContext(target.conversationId(),capture);
        boolean same=sourceRound(capture.messages()).equals(sourceRound(target.seed().expected().messages()));
        boolean approved=same && target.seed().approved();
        var seed=target.seed();
        visual.seed(target.id(),new Seed(seed.uid(),seed.hrName(),seed.companyName(),capture.session().jobName(),
                same?seed.draft():"",same && seed.sendResume(),approved,capture));
        AiDraft draft;
        if(approved) draft=new AiDraft(Classification.REPLY,target.seed().draft(),"本人已批准的测试回复；发送前仍复核当前会话"+(target.seed().sendResume()?"；文字后使用BOSS发简历":""),List.of(),List.of(),1);
        else {
            try {
                draft=autopilot.generate(run.profileId(),target.conversationId(),store.loadSettingsSecret(run.profileId()).communicationProfile(),capture);
                var audit=autopilot.assess(run.profileId(),target.conversationId(),capture,draft);
                draft=new AiDraft(draft.classification(),draft.replyText(),audit.reason(),draft.riskTags(),draft.missingFacts(),draft.confidence());
            }catch(RuntimeException e){draft=new AiDraft(Classification.NEEDS_USER,"","AI 生成或审核失败，需要本人填写",List.of("AI_FAILURE"),List.of(),0);}
        }
        long id=store.createProposal(run.profileId(),target.conversationId(),fingerprint,draft);
        policies.decision(id,policies.policy(run.profileId()).version(),"TEXT","视觉三会话：逐条确认，不能自动扩展授权",false);
        policies.markTrial(id);
        visual.target(target.id(),id,"REVIEW_REQUIRED",approved?"原卡片核对一致，已批准":"消息有变化或尚未确认，已发送新卡片");
        if(approved)queue(run.profileId(),id,store.getProposalView(run.profileId(),id).version());
        else {qq.notifyProposal(store.getProposalView(run.profileId(),id));if(batches.owner(run.id())!=null)visual.state(run.id(),"WAITING_REVIEW","等待本条 QQ 确认");}
    }
    private void send(Run run,Target target) {
        Step step=guard.locked(()->visual.claim(run.profileId(),target.proposalId()));if(step==null)return;
        var proposal=store.requireProposal(run.profileId(),target.proposalId());
        var expected=policies.context(run.profileId(),target.conversationId());
        var sent=visual.steps(target.proposalId()).stream().filter(s->"SENT_CONFIRMED".equals(s.get("status"))).toList();
        boolean resumeRule=visual.isResumeRuleRun(run.id());
        JsonNode batchResume=batches.resumeRequest(run.id());
        boolean nativeResume=resumeRule || batchResume!=null;
        var ownTexts=nativeResume ? expected.messages().subList(expected.messages().size()-trailingOwnCount(expected.messages()),expected.messages().size()).stream().map(ChatMessage::text).toList()
                : sent.stream().filter(s->"TEXT".equals(s.get("action_type"))).map(s->proposal.draft()).toList();
        var request=request(run,target,"prepare");request.put("actionType",step.actionType());request.put("draft",proposal.draft());
        request.put("contextBaseline",Map.of("hrName",target.seed().hrName(),"companyName",target.seed().companyName(),"contextComplete",expected.contextComplete(),"messages",expected.messages()));
        request.put("adoptApprovedDraft",visual.explicitlyReconfirmed(proposal.id()));
        request.put("expectedRound",round(expected.messages()));request.put("expectedSourceRound",sourceRound(expected.messages()));
        request.put("ownTexts",ownTexts);request.put("stepId",step.id());
        if(resumeRule) {request.put("resumeRule",true);request.put("resumeRequest",visual.resumeRequest(run.id()));}
        if(batchResume!=null){request.put("resumeRule",true);request.put("resumeRequest",batchResume);}
        var committed=new AtomicBoolean(false);
        JsonNode result;
        try {
            result=exchange(run.profileId(),request,prepared->guard.locked(()->{
                if(!visual.run(run.profileId(),run.id()).status().equals("RUNNING") || legacyPaused(run.profileId(),run.id()))return false;
                if(!batches.allows(run.profileId(),run.id()))return false;
                if(batchResume!=null && !step.actionType().equals("RESUME_NATIVE"))return false;
                if(resumeRule && (!step.actionType().equals("RESUME_NATIVE") || !visual.resumeRuleAuthorized(run.profileId(),run.id())))return false;
                if(!Objects.equals(profiles.getCurrentProfileId(),run.profileId()))return false;
                var current=store.requireProposal(run.profileId(),target.proposalId());
                if(current.version()!=proposal.version() || !current.draft().equals(proposal.draft()))return false;
                ChatCapture fresh=decode(target,prepared.path("capture"));
                if(!fresh.contextComplete() || !safeRound(fresh.messages(),expected.messages(),ownTexts))return false;
                visual.submitting(step,prepared.path("capture"));committed.set(true);return true;
            }));
        }catch(RuntimeException error){
            finish(run,target,step,committed.get()?"SEND_UNKNOWN":"BLOCKED",Map.of("detail",safeError(error)));return;
        }
        String outcome=result.path("outcome").asText("BLOCKED");
        if(!Set.of("SENT_CONFIRMED","SEND_UNKNOWN","BLOCKED","STALE").contains(outcome))outcome=committed.get()?"SEND_UNKNOWN":"BLOCKED";
        if(outcome.equals("SENT_CONFIRMED")) {
            // Independently validate the worker receipt, not just its boolean result.
            try {
                var fresh=decode(target,result.path("capture"));
                var expectedOwn=new ArrayList<>(ownTexts);
                if(step.actionType().equals("TEXT"))expectedOwn.add(proposal.draft());
                if(!receipt(fresh.messages(),expected.messages(),expectedOwn,step.actionType()))outcome="SEND_UNKNOWN";
            }catch(RuntimeException e){outcome="SEND_UNKNOWN";}
        }
        finish(run,target,step,outcome,result);
        if(Set.of("HUMAN_TAKEOVER","FOCUS_CHANGED","DESKTOP_LOCKED","CANCELLED").contains(result.path("code").asText()))
            {visual.state(run.id(),"PAUSED",result.path("detail").asText());if(resumeRule)visual.resumeRuleState(run.profileId(),"PAUSED",result.path("detail").asText());
                String batchId=batches.owner(run.id());if(batchId!=null){var batch=batches.get(run.profileId(),batchId);batches.state(batchId,"PAUSED",batch.stage(),result.path("detail").asText());}}
    }
    private boolean legacyPaused(Long profile,String run) {
        return batches.owner(run)==null && policies.policy(profile).paused();
    }
    private void finish(Run run,Target target,Step step,String outcome,Object evidence) {
        transaction.executeWithoutResult(tx->finishTransaction(run,target,step,outcome,evidence));
    }
    private void finishTransaction(Run run,Target target,Step step,String outcome,Object evidence) {
        visual.finish(step,outcome,evidence);
        boolean complete=visual.steps(target.proposalId()).stream().allMatch(s->"SENT_CONFIRMED".equals(s.get("status")));
        if(outcome.equals("SENT_CONFIRMED") && !complete){visual.target(target.id(),null,"PARTIAL","文字已确认发送，等待原生简历步骤");return;}
        visual.completeParent(step.commandId(),outcome);
        ProposalStatus status=switch(outcome){case "SENT_CONFIRMED"->ProposalStatus.SENT_CONFIRMED;case "STALE"->ProposalStatus.EXPIRED;case "BLOCKED"->ProposalStatus.BLOCKED;default->ProposalStatus.SEND_UNKNOWN;};
        store.markFinal(target.proposalId(),status,json.valueToTree(evidence).path("detail").asText(outcome));
        visual.target(target.id(),null,outcome,json.valueToTree(evidence).path("detail").asText(outcome));
        if(outcome.equals("SEND_UNKNOWN")) {
            String batchId=batches.owner(run.id());
            if(batchId!=null) {
                var batch=batches.get(run.profileId(),batchId);
                batches.state(batchId,"PAUSED",batch.stage(),"发送结果未知，已保留现场并暂停；该会话禁止自动重试");
            }
        }
        if(outcome.equals("SENT_CONFIRMED"))for(var m:decode(target,json.valueToTree(evidence).path("capture")).messages())store.saveMessage(target.conversationId(),m,store.loadSettingsSecret(run.profileId()).retentionDays());
        if(!visual.isResumeRuleRun(run.id()) && batches.resumeRequest(run.id())==null && outcome.equals("STALE") && visual.steps(target.proposalId()).stream().noneMatch(s->"SENT_CONFIRMED".equals(s.get("status")))) {
            var s=target.seed();visual.seed(target.id(),new Seed(s.uid(),s.hrName(),s.companyName(),s.jobName(),"",false,false,s.expected()));
            visual.target(target.id(),null,"PENDING_CAPTURE","消息已变化，重新读取并生成待确认卡片");
        }
        policies.notification(run.profileId(),"visual-final:"+step.id(),target.seed().companyName()+" / "+target.seed().hrName()+"\n"+
                (complete?"已确认发送：所有批准步骤均出现新增本人消息":"发送未全部确认："+outcome+"；已成功步骤不会重发"));
    }
    private ChatCapture decode(Target target,JsonNode node) {
        if(!normalize(node.path("hrName").asText()).equals(normalize(target.seed().hrName())) ||
                !normalize(node.path("companyName").asText()).equals(normalize(target.seed().companyName())))
            throw new IllegalStateException("视觉会话身份不匹配");
        List<ChatMessage> messages=new ArrayList<>();
        for(JsonNode m:node.path("messages"))messages.add(new ChatMessage(m.path("from").asText(),m.path("type").asText("文本"),m.path("text").asText(),m.path("time").asText()));
        var last=messages.isEmpty()?new ChatMessage("","","",""):messages.getLast();
        String job=node.path("jobName").asText();
        if(job.isBlank() || (!target.seed().jobName().isBlank() && !normalize(job).equals(normalize(target.seed().jobName()))))
            throw new IllegalStateException("视觉岗位不匹配或无法读取");
        return new ChatCapture(UUID.randomUUID().toString(),0,new ChatSession(target.seed().uid(),"",target.seed().hrName(),target.seed().companyName(),job,"",last.text(),last.time()),messages,false,node.path("contextComplete").asBoolean());
    }
    static String normalize(String text){return Objects.requireNonNullElse(text,"").replaceAll("\\s+","");}
    public static List<String> round(List<ChatMessage> messages) {
        int end=messages.size();while(end>0 && !messages.get(end-1).inbound())end--;
        int start=end;while(start>0 && messages.get(start-1).inbound())start--;
        return messages.subList(start,end).stream().map(m->normalize(m.text())).toList();
    }
    static boolean safeRound(List<ChatMessage> fresh,List<ChatMessage> expected,List<String> own) {
        if(!sourceRound(fresh).equals(sourceRound(expected)))return false;
        int end=fresh.size();while(end>0 && !fresh.get(end-1).inbound())end--;
        return fresh.subList(end,fresh.size()).stream().map(m->normalize(m.text())).toList().equals(own.stream().map(HrVisualService::normalize).toList());
    }
    static List<String> sourceRound(List<ChatMessage> messages) {
        int end=messages.size();while(end>0 && !messages.get(end-1).inbound())end--;
        int start=end;while(start>0 && messages.get(start-1).inbound())start--;
        return messages.subList(start,end).stream().map(m->normalize(m.type())+"|"+normalize(m.time())+"|"+normalize(m.text())).toList();
    }
    static boolean receipt(List<ChatMessage> fresh,List<ChatMessage> expected,List<String> own,String action) {
        if(action.equals("TEXT"))return safeRound(fresh,expected,own);
        if(fresh.isEmpty())return false;
        var last=fresh.getLast();
        return !last.inbound() && last.type().equals("简历") && !last.text().isBlank() && safeRound(fresh.subList(0,fresh.size()-1),expected,own);
    }
    private static String safeError(Exception e){String s=e.getMessage();return s==null?e.getClass().getSimpleName():s.substring(0,Math.min(s.length(),240));}
}
