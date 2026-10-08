package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.*;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Objects;

/** One explicit text review of stored evidence; never widens permanent history or personal facts. */
@Service
@RequiredArgsConstructor
public class HrBackgroundReviewService {
    private final HrBackgroundStore background;
    private final HrAssistantStore store;
    private final HrAutopilotStore policies;

    public record ReviewRequest(Long expectedProfileId,int expectedPolicyVersion,String draft) { }

    // Caller holds HrProfileGuard through the transaction, including its commit.
    @Transactional
    public ProposalView prepare(Long profile,String account,String captureId,ReviewRequest request) {
        if(request==null || !profile.equals(request.expectedProfileId()))
            throw new HrAssistantStore.StaleProposalException("当前人物档案已变化");
        var policy=policies.policy(profile);
        if(policy.version()!=request.expectedPolicyVersion() || !policy.enabled() || policy.paused() || !policies.authorizationValid(profile))
            throw new HrAssistantStore.StaleProposalException("托管规则或授权已变化，请重新核对");
        String draft=Objects.toString(request.draft(),"").trim();
        if(draft.isBlank() || draft.length()>2000)throw new IllegalArgumentException("人工文字回复应为1–2000字");
        var capture=background.requireCapturedSource(profile,account,policy.version(),captureId);
        if(!capture.contextComplete() || !HrBackgroundStore.completeContact(capture.session()) || capture.messages().isEmpty()
                || !capture.messages().getLast().inbound())
            throw new HrAssistantStore.StaleProposalException("聊天身份或上下文未完整读取，或本人已经回复，请先核验真实页面");
        int start=capture.messages().size();
        while(start>0 && capture.messages().get(start-1).inbound())start--;
        var round=capture.messages().subList(start,capture.messages().size());
        if(round.stream().anyMatch(m->!"文本".equals(m.type()) || m.text()==null || m.text().isBlank()
                || Objects.toString(m.messageId(),"").isBlank() || !m.media().isEmpty())
                || round.stream().map(ChatMessage::messageId).distinct().count()!=round.size())
            throw new HrAssistantStore.StaleProposalException("最新消息包含未核实的卡片或非文本内容，不能只回复部分来源");
        var source=round.getLast();
        if(!normalize(source.text()).equals(normalize(capture.session().lastMessage())))
            throw new HrAssistantStore.StaleProposalException("最新入站消息与会话预览不一致，请重新读取");
        long conversation=background.resolveConversation(profile,capture);
        if(policies.conversationHeld(conversation))
            throw new HrAssistantStore.StaleProposalException("此会话存在未核验发送，请先确认原发送结果");
        String fingerprint=background.sourceFingerprint(profile,conversation,capture,source);
        store.requireCurrentOrUnseenSource(profile,conversation,fingerprint);
        // Reconsider only system history skips. Existing sends, manual skips and edited reviews remain handled.
        if(store.hasHandledManualReviewSource(conversation,fingerprint))
            throw new HrAssistantStore.StaleProposalException("此来源已有回复或复核记录，未重复创建");
        var settings=store.loadSettingsSecret(profile);
        for(var message:capture.messages())store.saveMessage(conversation,message,settings.retentionDays());
        store.updateLastInbound(conversation,fingerprint);
        policies.context(conversation,capture);
        long proposal=store.createProposal(profile,conversation,fingerprint,new AiDraft(Classification.REPLY,draft,
                "用户针对所选来源的一次性人工复核",List.of(),List.of(),1));
        policies.decision(proposal,policy.version(),"TEXT","所选消息人工复核；发送前仍须真实页面核验完整来源轮",false);
        policies.audit(proposal,"已存快照单次人工文字复核",capture.historical());
        return store.getProposalView(profile,proposal);
    }

    private String normalize(String value) {return Objects.toString(value,"").replaceAll("\\s+","");}
}
