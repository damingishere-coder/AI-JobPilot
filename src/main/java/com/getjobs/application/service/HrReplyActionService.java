package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.SendCommandView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class HrReplyActionService {
    private HrVisualService visual;
    @org.springframework.beans.factory.annotation.Autowired
    public void setVisual(@org.springframework.context.annotation.Lazy HrVisualService visual) { this.visual=visual; }
    private HrAutopilotStore autopilotStore;
    private HrAutopilotService autopilot;
    private HrAssistantWatchService watchService;
    @org.springframework.beans.factory.annotation.Autowired
    public void setWatchService(@org.springframework.context.annotation.Lazy HrAssistantWatchService watchService) { this.watchService=watchService; }
    private HrBackgroundStore backgroundStore;
    @org.springframework.beans.factory.annotation.Autowired
    public void setBackgroundStore(@org.springframework.context.annotation.Lazy HrBackgroundStore backgroundStore) { this.backgroundStore=backgroundStore; }
    @org.springframework.beans.factory.annotation.Autowired
    public void setAutopilot(HrAutopilotStore store, HrAutopilotService service) { this.autopilotStore=store; this.autopilot=service; }
    private final HrAssistantStore store;
    private final HrAssistantEventService events;

    public ProposalView revise(Long profileId, long proposalId, int expectedVersion, String newDraft) {
        if (visual != null) visual.assertEditable(profileId, proposalId);
        ProposalView updated = store.revise(profileId, proposalId, expectedVersion, newDraft);
        if(autopilotStore!=null) autopilotStore.decision(proposalId,autopilotStore.policy(profileId).version(),"TEXT","用户修改后的文字回复",false);
        events.emit("proposal-updated", updated);
        return updated;
    }

    public ProposalView reviseByCode(Long profileId, String code, String newDraft) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return revise(profileId, record.id(), record.version(), newDraft);
    }

    public ProposalView skip(Long profileId, long proposalId) {
        if (visual != null) visual.assertEditable(profileId, proposalId);
        store.skip(profileId, proposalId);
        if (visual != null) visual.skipped(profileId, proposalId);
        ProposalView updated = store.getProposalView(profileId, proposalId);
        events.emit("proposal-updated", updated);
        return updated;
    }

    public ProposalView skipByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return skip(profileId, record.id());
    }

    public ProposalView send(Long profileId, long proposalId, int expectedVersion) {
        if (visual != null && visual.owns(profileId, proposalId)) return visual.queue(profileId, proposalId, expectedVersion);
        if (watchService != null) watchService.requireTrialSend(profileId, proposalId);
        String commandId = store.queueSendCommand(profileId, proposalId, expectedVersion, "");
        ProposalView queued = store.getProposalView(profileId, proposalId);
        events.emit("proposal-send-pending", java.util.Map.of("commandId", commandId, "proposal", queued));
        return queued;
    }

    public ProposalView sendByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return send(profileId, record.id(), record.version());
    }

    public SendCommandView claim(Long profileId, String watchSessionId) {
        return claim(profileId, watchSessionId, null);
    }

    public SendCommandView claim(Long profileId, String watchSessionId, java.util.Set<Long> allowedProposalIds) {
        if (autopilot != null && autopilot.policy(profileId).paused()) return null;
        SendCommandView command = allowedProposalIds == null ? store.claimSendCommand(profileId, watchSessionId)
                : store.claimSendCommand(profileId, watchSessionId, allowedProposalIds);
        if (command != null && autopilot != null) {
            try { autopilot.verifyClaim(profileId, command.proposalId()); }
            catch (RuntimeException e) {
                store.completeSendCommand(profileId,watchSessionId,command.commandId(),command.leaseToken(),"FAILED_SAFE",e.getMessage(),null);
                return null;
            }
        }
        if (command != null) events.emit("proposal-sending", store.getProposalView(profileId, command.proposalId()));
        if(command!=null && autopilotStore!=null) {
            var decision=autopilotStore.decision(command.proposalId());
            var policy=autopilotStore.policy(profileId);
            com.getjobs.application.hr.HrAssistantTypes.ChatCapture context;
            try {context=autopilotStore.context(profileId,store.requireProposal(profileId,command.proposalId()).conversationId());}
            catch(RuntimeException e) {
                store.completeSendCommand(profileId,watchSessionId,command.commandId(),command.leaseToken(),"FAILED_SAFE","上下文不可用，未下发浏览器动作",null);
                return null;
            }
            var messages=context.messages(); int start=messages.size();
            while(start>0 && messages.get(start-1).inbound()) start--;
            command=new SendCommandView(command.commandId(),command.leaseToken(),command.proposalId(),context.session().uid(),command.hrName(),
                    command.companyName(),command.jobName(),command.sourceFingerprint(),command.expectedLatestInbound(),command.draft(),
                    command.expiresAt(),command.leaseDeadlineEpochMs(),decision.action().equals("RESUME_NATIVE")?"RESUME_NATIVE":decision.action().equals("RESUME")?"RESUME":decision.action().equals("PHONE")?"PHONE":"TEXT",
                    policy.enabled()?policy.version():0,policy.resumeName(),policy.resumeSha256(),messages.subList(start,messages.size()));
        }
        return command;
    }

    public void dispatch(Long profileId,String watchSessionId,String commandId,String leaseToken,ChatCapture before) {
        var proposal=store.proposalForCommand(profileId,commandId);
        if(autopilot==null || autopilotStore==null)throw new IllegalStateException("发送规则服务不可用");
        autopilot.verifyClaim(profileId,proposal.id());
        ChatCapture expected=autopilotStore.context(profileId,proposal.conversationId());
        if(before==null || before.session()==null || !sameIdentity(expected,before)
                || !sourceRound(expected).equals(sourceRound(before)))throw new HrAssistantStore.StaleProposalException("提交前完整身份或 HR 来源轮已变化");
        String source=backgroundStore==null?null:backgroundStore.sourceFingerprint(profileId,proposal.conversationId(),before,before.messages().getLast());
        store.dispatchSendCommand(profileId,watchSessionId,commandId,leaseToken,before,source);
    }

    public ProposalView complete(Long profileId,String watchSessionId,String commandId,String leaseToken,String outcome,String evidence,
                                 ChatMessage observedLatestInbound,ChatCapture observed,boolean background) {
        String canonicalSource=null;
        if(background && "SENT".equalsIgnoreCase(outcome)) {
            var proposal=store.proposalForCommand(profileId,commandId);
            ChatCapture before=store.beforeDispatch(profileId,watchSessionId,commandId,leaseToken);
            String action=autopilotStore==null?"TEXT":autopilotStore.decision(proposal.id()).action();
            if(!confirmedReceipt(before,observed,proposal.draft(),action)) {
                outcome="RESULT_UNKNOWN";evidence="完整新增本人消息回执未通过后端核验";
            }else {
                observedLatestInbound=observed.messages().stream().filter(ChatMessage::inbound).reduce((left,right)->right).orElse(null);
                if(backgroundStore!=null)canonicalSource=backgroundStore.sourceFingerprint(profileId,proposal.conversationId(),observed,observedLatestInbound);
            }
        }
        return completeResolved(profileId,watchSessionId,commandId,leaseToken,outcome,evidence,observedLatestInbound,canonicalSource);
    }

    public ProposalView completePersistedBackground(Long profileId,String watchSessionId,String commandId,String leaseToken,String outcome,String evidence,
                                                   ChatMessage inbound,ChatCapture observed) {
        var status=store.backgroundCommandStatus(profileId,watchSessionId,commandId,leaseToken);
        if(!"LEASED".equals(status.get("state")))return store.getProposalView(profileId,((Number)status.get("proposalId")).longValue());
        return complete(profileId,watchSessionId,commandId,leaseToken,outcome,evidence,inbound,observed,true);
    }

    static boolean confirmedReceipt(ChatCapture before,ChatCapture after,String draft,String action) {
        if(before==null || after==null || !before.contextComplete() || !after.contextComplete() || !sameIdentity(before,after)
                || before.messages().isEmpty() || after.messages().size()!=before.messages().size()+1)return false;
        for(int i=0;i<before.messages().size();i++)if(!HrBackgroundStore.sameMessage(before.messages().get(i),after.messages().get(i)))return false;
        ChatMessage added=after.messages().getLast();
        if(added.inbound())return false;
        if("RESUME_NATIVE".equals(action) || "RESUME".equals(action))
            return "简历".equals(added.type()) && !normalize(added.text()).isBlank();
        return normalize(added.text()).equals(normalize(draft));
    }
    private static boolean sameIdentity(ChatCapture left,ChatCapture right) {
        return left!=null && right!=null && left.session()!=null && right.session()!=null
                && left.session().uid().equals(right.session().uid())
                && normalize(left.session().hrName()).equals(normalize(right.session().hrName()))
                && normalize(left.session().companyName()).equals(normalize(right.session().companyName()))
                && normalize(left.session().jobName()).equals(normalize(right.session().jobName()));
    }
    private static java.util.List<String> sourceRound(ChatCapture capture) {
        int end=capture.messages().size();while(end>0 && !capture.messages().get(end-1).inbound())end--;
        int start=end;while(start>0 && capture.messages().get(start-1).inbound())start--;
        return capture.messages().subList(start,end).stream().map(m->normalize(m.type())+"|"+normalize(m.time())+"|"+normalize(m.text())).toList();
    }
    private static String normalize(String text){return java.util.Objects.toString(text,"").replaceAll("\\s+","");}

    public ProposalView complete(Long profileId,
                                 String watchSessionId,
                                 String commandId,
                                 String leaseToken,
                                 String outcome,
                                 String evidence,
                                 ChatMessage observedLatestInbound) {
        return completeResolved(profileId,watchSessionId,commandId,leaseToken,outcome,evidence,observedLatestInbound,null);
    }
    private ProposalView completeResolved(Long profileId,String watchSessionId,String commandId,String leaseToken,String outcome,String evidence,
                                         ChatMessage observedLatestInbound,String canonicalSource) {
        ProposalView result = canonicalSource==null?store.completeSendCommand(profileId,watchSessionId,commandId,leaseToken,outcome,evidence,observedLatestInbound):
                store.completeSendCommand(profileId,watchSessionId,commandId,leaseToken,outcome,evidence,observedLatestInbound,canonicalSource);
        events.emit("proposal-updated", result);
        if(autopilotStore!=null && (!autopilotStore.decision(result.id()).automatic() || "SEND_UNKNOWN".equals(result.status()) || "BLOCKED".equals(result.status())))
            autopilotStore.notification(profileId,"send-final:"+result.id()+":"+result.status(),"【"+result.confirmationCode()+"】"
                +result.companyName()+" / "+result.hrName()+"\n"+("SENT_CONFIRMED".equals(result.status())?"已确认发送":"发送需人工核验："+result.status()));
        if(autopilotStore!=null && ("SEND_UNKNOWN".equals(result.status()) || "BLOCKED".equals(result.status())))
            autopilotStore.decision(result.id(),autopilotStore.policy(profileId).version(),"HUMAN","发送需人工核验",false);
        return result;
    }

    public ProposalView detailByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return store.getProposalView(profileId, record.id());
    }

    public Object contextByCode(Long profileId, String code) {
        var proposal=store.requireProposalByCode(profileId,normalizeCode(code));
        return autopilotStore.context(profileId,proposal.conversationId());
    }

    public ProposalView supplementByCode(Long profileId, String code, String fact) {
        var record=store.requireProposalByCode(profileId,normalizeCode(code));
        var capture=autopilotStore.context(profileId,record.conversationId());
        autopilotStore.supplement(profileId,record.conversationId(),fact);
        var draft=autopilot.generate(profileId,record.conversationId(),store.loadSettingsSecret(profileId).communicationProfile(),capture);
        if(draft.replyText().isBlank()) throw new IllegalStateException("事实已补充，但仍缺少可发送正文，请使用修改指令");
        return revise(profileId,record.id(),record.version(),draft.replyText());
    }

    private String normalizeCode(String code) {
        String value = code == null ? "" : code.trim();
        if (!value.matches("\\d{4}")) throw new IllegalArgumentException("确认码必须是 4 位数字");
        return value;
    }
}
