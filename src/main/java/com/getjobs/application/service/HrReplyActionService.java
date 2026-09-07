package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.SendCommandView;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class HrReplyActionService {
    private HrAutopilotStore autopilotStore;
    private HrAutopilotService autopilot;
    @org.springframework.beans.factory.annotation.Autowired
    public void setAutopilot(HrAutopilotStore store, HrAutopilotService service) { this.autopilotStore=store; this.autopilot=service; }
    private final HrAssistantStore store;
    private final HrAssistantEventService events;

    public ProposalView revise(Long profileId, long proposalId, int expectedVersion, String newDraft) {
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
        store.skip(profileId, proposalId);
        ProposalView updated = store.getProposalView(profileId, proposalId);
        events.emit("proposal-updated", updated);
        return updated;
    }

    public ProposalView skipByCode(Long profileId, String code) {
        HrAssistantStore.ProposalRecord record = store.requireProposalByCode(profileId, normalizeCode(code));
        return skip(profileId, record.id());
    }

    public ProposalView send(Long profileId, long proposalId, int expectedVersion) {
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
        if (autopilot != null && autopilot.policy(profileId).paused()) return null;
        SendCommandView command = store.claimSendCommand(profileId, watchSessionId);
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
            command=new SendCommandView(command.commandId(),command.leaseToken(),command.proposalId(),command.uid(),command.hrName(),
                    command.companyName(),command.jobName(),command.sourceFingerprint(),command.expectedLatestInbound(),command.draft(),
                    command.expiresAt(),command.leaseDeadlineEpochMs(),decision.action().equals("RESUME")?"RESUME":decision.action().equals("PHONE")?"PHONE":"TEXT",
                    policy.enabled()?policy.version():0,policy.resumeName(),policy.resumeSha256(),messages.subList(start,messages.size()));
        }
        return command;
    }

    public ProposalView complete(Long profileId,
                                 String watchSessionId,
                                 String commandId,
                                 String leaseToken,
                                 String outcome,
                                 String evidence,
                                 ChatMessage observedLatestInbound) {
        ProposalView result = store.completeSendCommand(profileId, watchSessionId, commandId, leaseToken,
                outcome, evidence, observedLatestInbound);
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
