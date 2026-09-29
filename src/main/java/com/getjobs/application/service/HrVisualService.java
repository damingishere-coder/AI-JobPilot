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
    private final AtomicBoolean executing=new AtomicBoolean();
    private final ExecutorService executor=Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());

    @PostConstruct
    void initialize() {
        transaction.executeWithoutResult(tx->{
            for(Long id:visual.recover()) store.markFinal(id,ProposalStatus.SEND_UNKNOWN,"执行进程重启，无法确认发送结果，禁止自动重试");
        });
        guard.registerAdditionalBlocker(()->visual.busy() || executing.get());
    }
    @PreDestroy void shutdown() {worker.cancel();executor.shutdownNow();}
    @Scheduled(cron="0 20 3 * * *")
    public void purgeSensitiveCopies() {
        guard.locked(()->{if(!executing.get())worker.purgeEvidence(visual.purgeSensitiveCopies());return null;});
    }

    public Object status(Long profile) {
        var runs=visual.runs(profile);
        var result=new LinkedHashMap<String,Object>(worker.availability());
        result.put("running",visual.busy());result.put("executing",executing.get());result.put("replyMode","REVIEW");
        result.put("intervalSeconds",5);result.put("napcatConnected",qq.isConnected());
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
            if(!Set.of(ProposalStatus.BLOCKED,ProposalStatus.SEND_UNKNOWN,ProposalStatus.EXPIRED).contains(old.status()) ||
                    old.version()!=review.expectedVersion() || old.draft().isBlank() || old.draft().length()>2000 || !old.draft().equals(review.draft()))
                throw new IllegalStateException("只能重新确认当前失败版本的完整原文");
            if((old.status()==ProposalStatus.SEND_UNKNOWN || visual.previousUnknownAttempt(target.id())) && !review.possibleDuplicateAccepted())
                throw new IllegalArgumentException("前次结果未知，必须本人核验并明确重新授权，不能自动重试");
            if(visual.hasOtherLaterAttempt(target.conversationId(),old.id()) || visual.steps(old.id()).stream().anyMatch(s->"SENT_CONFIRMED".equals(s.get("status"))))
                throw new IllegalStateException("已有其他发送或部分成功步骤，不能重发文字");
            if(!executing.compareAndSet(false,true)) throw new IllegalStateException("桌面仍在执行");
            try {
                JsonNode observed=worker.exchange(request(run,target,"inspect"),null);
                if(!observed.path("ok").asBoolean()) throw new IllegalStateException(observed.path("detail").asText("复核失败"));
                var fresh=decode(target,observed.path("capture"));
                if(!fresh.contextComplete() || !safeRound(fresh.messages(),target.seed().expected().messages(),List.of()))
                    throw new IllegalStateException("本轮消息已变化或出现本人回复，不能按原文重新发送");
                String composer=observed.path("composer").asText();
                if(!composer.isBlank() && !normalize(composer).equals(normalize(old.draft())))
                    throw new IllegalStateException("输入框有不同的人工草稿，未覆盖");
                return transaction.execute(tx->{
                    autopilot.saveContext(target.conversationId(),fresh);
                    long next=store.createProposal(profile,target.conversationId(),old.sourceFingerprint(),
                            new AiDraft(Classification.REPLY,old.draft(),"本人复核后重新确认；前次 #"+old.id()+" 的结果与证据保留",List.of(),List.of(),1));
                    policies.decision(next,policies.policy(profile).version(),"TEXT","人工重新确认，保留原始记录",false);policies.markTrial(next);
                    visual.recordReconfirmation(target.id(),old.id(),next);
                    var s=target.seed();visual.seed(target.id(),new Seed(s.uid(),s.hrName(),s.companyName(),s.jobName(),old.draft(),s.sendResume(),true,fresh));
                    String command=store.queueSendCommand(profile,next,1,"visual:"+run.id());visual.attach(command,s.sendResume());
                    visual.target(target.id(),next,"QUEUED","本人重新确认，原记录保留；等待恢复测试");
                    visual.state(run.id(),"PAUSED","复核完成，等待恢复测试");
                    return status(profile);
                });
            } finally {executing.set(false);}
        });
    }
    public boolean owns(Long profile,long proposal) {return visual.owner(profile,proposal)!=null;}
    public boolean qqControl(Long profile,boolean resume) {
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
            if(!visual.run(profile,t.runId()).status().equals("RUNNING") || policies.policy(profile).paused()) throw new IllegalStateException("视觉测试已暂停，请先恢复");
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
        if(!visual.busy() || !executing.compareAndSet(false,true)) return;
        executor.submit(()->{
            try { advance(); }
            finally { executing.set(false); }
        });
    }
    private void advance() {
        Long profile=profiles.getCurrentProfileIdOrNull();if(profile==null)return;
        for(Run run:visual.runs(profile)) {
            if(run.status().equals("STOPPING")) {visual.state(run.id(),"PAUSED",run.reason());continue;}
            if(!run.status().equals("RUNNING"))continue;
            if(policies.policy(profile).paused())return;
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
        return r;
    }
    private void capture(Run run,Target target) {
        JsonNode response=worker.exchange(request(run,target,"inspect"),null);
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
        else qq.notifyProposal(store.getProposalView(run.profileId(),id));
    }
    private void send(Run run,Target target) {
        Step step=guard.locked(()->visual.claim(run.profileId(),target.proposalId()));if(step==null)return;
        var proposal=store.requireProposal(run.profileId(),target.proposalId());
        var expected=policies.context(run.profileId(),target.conversationId());
        var sent=visual.steps(target.proposalId()).stream().filter(s->"SENT_CONFIRMED".equals(s.get("status"))).toList();
        var ownTexts=sent.stream().filter(s->"TEXT".equals(s.get("action_type"))).map(s->proposal.draft()).toList();
        var request=request(run,target,"prepare");request.put("actionType",step.actionType());request.put("draft",proposal.draft());
        request.put("adoptApprovedDraft",visual.explicitlyReconfirmed(proposal.id()));
        request.put("expectedRound",round(expected.messages()));request.put("expectedSourceRound",sourceRound(expected.messages()));
        request.put("ownTexts",ownTexts);request.put("stepId",step.id());
        var committed=new AtomicBoolean(false);
        JsonNode result;
        try {
            result=worker.exchange(request,prepared->guard.locked(()->{
                if(!visual.run(run.profileId(),run.id()).status().equals("RUNNING") || policies.policy(run.profileId()).paused())return false;
                if(!Objects.equals(profiles.getCurrentProfileId(),run.profileId()))return false;
                var current=store.requireProposal(run.profileId(),target.proposalId());
                if(current.version()!=proposal.version() || !current.draft().equals(proposal.draft()))return false;
                ChatCapture fresh=decode(target,prepared.path("capture"));
                if(!fresh.contextComplete() || !safeRound(fresh.messages(),expected.messages(),ownTexts))return false;
                visual.submitting(step);committed.set(true);return true;
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
            visual.state(run.id(),"PAUSED",result.path("detail").asText());
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
        if(outcome.equals("STALE") && visual.steps(target.proposalId()).stream().noneMatch(s->"SENT_CONFIRMED".equals(s.get("status")))) {
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
