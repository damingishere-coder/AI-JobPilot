package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.GatewayStatus;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.UnreadConversation;
import com.getjobs.application.hr.HrAssistantTypes.UnreadSnapshot;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class HrAssistantWatchServiceTest {
    private final OpenCliBossGateway gateway = mock(OpenCliBossGateway.class);
    private final ProfileService profileService = mock(ProfileService.class);
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrReplyDraftService draftService = mock(HrReplyDraftService.class);
    private final HrAssistantEventService events = mock(HrAssistantEventService.class);
    private final NapCatGateway napCatGateway = mock(NapCatGateway.class);
    private HrAssistantWatchService service;

    @AfterEach
    void tearDown() {
        if (service != null) service.shutdown();
    }

    @Test
    void discoversSixteenUnreadConversationsOnceAndImmediateTicksDoNotOverlapOrRepeat() throws Exception {
        List<ChatSession> sessions = IntStream.rangeClosed(1, 16)
                .mapToObj(index -> new ChatSession("uid-" + index, "security-" + index, "HR" + index,
                        "公司" + index, "岗位" + index, "HR", "消息" + index, "11:02"))
                .toList();
        AtomicInteger snapshots = new AtomicInteger();
        AtomicInteger proposalIds = new AtomicInteger(100);
        when(gateway.status()).thenReturn(new GatewayStatus(true, "1.8.2", "ready"));
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        when(store.loadSettingsSecret(1L)).thenReturn(new HrAssistantStore.SettingsSecret(
                1L, CommunicationProfile.empty(), false, "ws://127.0.0.1:3001", "", "", 30));
        when(gateway.listChats(100)).thenReturn(sessions);
        when(gateway.readUnreadSnapshot()).thenAnswer(ignored -> {
            int index = snapshots.getAndIncrement();
            if (index >= 16) return new UnreadSnapshot(0, List.of());
            ChatSession session = sessions.get(index);
            return new UnreadSnapshot(16 - index, List.of(new UnreadConversation(
                    0, 1, session.hrName(), session.companyName(), session.jobName(), session.lastMessage(), session.lastTime())));
        });
        when(gateway.matchUnique(any(UnreadConversation.class), eq(sessions))).thenAnswer(invocation -> {
            UnreadConversation unread = invocation.getArgument(0);
            int index = Integer.parseInt(unread.hrName().substring(2)) - 1;
            return sessions.get(index);
        });
        when(gateway.readMessages(any())).thenAnswer(invocation -> {
            String uid = invocation.getArgument(0);
            int index = Integer.parseInt(uid.substring(4));
            return List.of(new ChatMessage("对方", "文本", "消息" + index, "11:02"));
        });
        when(store.upsertConversation(eq(1L), any(ChatSession.class))).thenAnswer(invocation -> {
            ChatSession session = invocation.getArgument(1);
            return Long.parseLong(session.uid().substring(4));
        });
        when(store.sourceFingerprint(anyLong(), any(ChatMessage.class))).thenAnswer(invocation -> "fp-" + invocation.getArgument(0));
        when(store.hasProposalForSource(anyLong(), any())).thenReturn(false);
        when(store.recentMessages(anyLong(), anyInt())).thenReturn(List.of());
        when(draftService.generate(eq(1L), anyLong(), any(CommunicationProfile.class), anyList()))
                .thenReturn(new AiDraft(Classification.REPLY, "您好", "普通消息", List.of(), List.of(), 0.9));
        when(store.createProposal(eq(1L), anyLong(), any(), any(AiDraft.class)))
                .thenAnswer(ignored -> (long) proposalIds.incrementAndGet());
        when(store.getProposalView(eq(1L), anyLong())).thenAnswer(invocation -> proposal(invocation.getArgument(1)));

        service = new HrAssistantWatchService(gateway, profileService, store, draftService, events, napCatGateway, 100, 60_000);
        service.start();
        waitForCompletedScan();
        for (int i = 0; i < 8; i++) service.scheduledScan();
        Thread.sleep(200);

        assertThat(service.status().lastError()).isEmpty();
        verify(store, times(16)).createProposal(eq(1L), anyLong(), any(), any(AiDraft.class));
        verify(gateway, times(1)).listChats(100);
    }

    @Test
    void scrollsWhenUnreadBadgesAreBelowTheVisibleVirtualList() throws Exception {
        ChatSession session = new ChatSession("uid-1", "security-1", "HR1",
                "公司1", "岗位1", "HR", "消息1", "11:02");
        AtomicInteger snapshots = new AtomicInteger();
        when(gateway.status()).thenReturn(new GatewayStatus(true, "1.8.2", "ready"));
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        when(store.loadSettingsSecret(1L)).thenReturn(new HrAssistantStore.SettingsSecret(
                1L, CommunicationProfile.empty(), false, "ws://127.0.0.1:3001", "", "", 30));
        when(gateway.listChats(100)).thenReturn(List.of(session));
        when(gateway.readUnreadSnapshot()).thenAnswer(ignored -> switch (snapshots.getAndIncrement()) {
            case 0 -> new UnreadSnapshot(1, List.of());
            case 1 -> new UnreadSnapshot(1, List.of(new UnreadConversation(
                    0, 1, session.hrName(), session.companyName(), session.jobName(), session.lastMessage(), session.lastTime())));
            default -> new UnreadSnapshot(0, List.of());
        });
        when(gateway.scrollUnreadList()).thenReturn(true);
        when(gateway.matchUnique(any(UnreadConversation.class), anyList())).thenReturn(session);
        when(gateway.readMessages(session.uid())).thenReturn(List.of(new ChatMessage("对方", "文本", "消息1", "11:02")));
        when(store.upsertConversation(1L, session)).thenReturn(1L);
        when(store.sourceFingerprint(anyLong(), any(ChatMessage.class))).thenReturn("fp-1");
        when(store.hasProposalForSource(1L, "fp-1")).thenReturn(true);

        service = new HrAssistantWatchService(gateway, profileService, store, draftService, events, napCatGateway, 100, 60_000);
        service.start();
        waitForCompletedScan();

        assertThat(service.status().lastError()).isEmpty();
        verify(gateway, times(1)).scrollUnreadList();
        verify(gateway, times(3)).readUnreadSnapshot();
    }

    private void waitForCompletedScan() throws InterruptedException {
        long deadline = System.nanoTime() + 5_000_000_000L;
        while (service.status().lastScanAt() == null && System.nanoTime() < deadline) Thread.sleep(20);
        assertThat(service.status().lastScanAt()).isNotNull();
    }

    private ProposalView proposal(long id) {
        return new ProposalView(id, 1L, id, "1234", "REVIEW_REQUIRED", "REPLY", "HR", "公司", "岗位",
                "消息", "您好", "普通消息", List.of(), List.of(), 0.9, 1,
                LocalDateTime.now().plusMinutes(15), LocalDateTime.now(), false);
    }
}
