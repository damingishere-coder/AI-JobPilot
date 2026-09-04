package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.AiDraft;
import com.getjobs.application.hr.HrAssistantTypes.ChatCapture;
import com.getjobs.application.hr.HrAssistantTypes.ChatMessage;
import com.getjobs.application.hr.HrAssistantTypes.ChatSession;
import com.getjobs.application.hr.HrAssistantTypes.Classification;
import com.getjobs.application.hr.HrAssistantTypes.CommunicationProfile;
import com.getjobs.application.hr.HrAssistantTypes.ProposalView;
import com.getjobs.application.hr.HrAssistantTypes.QqTargetType;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.IntStream;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
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
    private final ProfileService profileService = mock(ProfileService.class);
    private final HrAssistantStore store = mock(HrAssistantStore.class);
    private final HrReplyDraftService draftService = mock(HrReplyDraftService.class);
    private final HrAssistantEventService events = mock(HrAssistantEventService.class);
    private final NapCatGateway napCatGateway = mock(NapCatGateway.class);
    private HrAssistantWatchService service;

    @BeforeEach
    void setUp() {
        when(profileService.getCurrentProfileId()).thenReturn(1L);
        when(store.loadSettingsSecret(1L)).thenReturn(new HrAssistantStore.SettingsSecret(
                1L, CommunicationProfile.empty(), false, "ws://127.0.0.1:3001", "",
                QqTargetType.PRIVATE, "", "", 30));
        service = new HrAssistantWatchService(profileService, store, draftService, events, napCatGateway, 100);
    }

    @Test
    void bindsOnlyTheExactCurrentBossChatTab() {
        var status = service.start(77, "https://www.zhipin.com/web/geek/chat?ka=header-message",
                "2026-09-04-boss-hr-direct", "browser-session");

        assertThat(status.watching()).isTrue();
        assertThat(status.watchSessionId()).isNotBlank();
        assertThat(status.intervalMs()).isEqualTo(60_000L);
        assertThat(status.chromeBridge().tabId()).isEqualTo(77);
        assertThat(status.chromeBridge().tabBound()).isTrue();
        assertThatThrownBy(() -> service.start(78, "https://www.zhipin.com/web/geek/job",
                "version", "other-session")).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void ingestsSixteenCapturesOnceAndAcknowledgesDuplicateCaptureIds() {
        var status = service.start(77, "https://www.zhipin.com/web/geek/chat", "version", "browser-session");
        List<ChatCapture> captures = IntStream.rangeClosed(1, 16).mapToObj(this::capture).toList();
        when(store.beginCapture(eq(1L), eq(status.watchSessionId()), eq("scan-1"), any())).thenReturn(true);
        when(store.upsertConversation(eq(1L), any(ChatSession.class))).thenAnswer(call -> {
            ChatSession session = call.getArgument(1);
            return Long.parseLong(session.uid().substring(4));
        });
        when(store.sourceFingerprint(anyLong(), any(ChatMessage.class))).thenAnswer(call -> "fp-" + call.getArgument(0));
        when(store.hasProposalForSource(anyLong(), any())).thenReturn(false);
        when(store.recentMessages(anyLong(), anyInt())).thenReturn(List.of());
        when(draftService.generate(eq(1L), anyLong(), any(CommunicationProfile.class), anyList()))
                .thenReturn(new AiDraft(Classification.REPLY, "您好", "普通消息", List.of(), List.of(), 0.9));
        when(store.createProposal(eq(1L), anyLong(), any(), any(AiDraft.class))).thenReturn(101L);
        when(store.getProposalView(eq(1L), anyLong())).thenReturn(proposal());

        var receipt = service.ingestScan(status.watchSessionId(), 77, "scan-1", 16, captures);

        assertThat(receipt.received()).isEqualTo(16);
        assertThat(receipt.processed()).isEqualTo(16);
        assertThat(receipt.acknowledgedCaptureIds()).hasSize(16);
        verify(store, times(16)).createProposal(eq(1L), anyLong(), any(), any(AiDraft.class));

        when(store.beginCapture(eq(1L), eq(status.watchSessionId()), eq("scan-2"), any())).thenReturn(false);
        var duplicate = service.ingestScan(status.watchSessionId(), 77, "scan-2", 16, captures);
        assertThat(duplicate.duplicates()).isEqualTo(16);
        assertThat(duplicate.processed()).isZero();
    }

    @Test
    void browserHeartbeatDoesNotOccupyTheBackendProcessingLock() {
        var status = service.start(77, "https://www.zhipin.com/web/geek/chat", "version", "browser-session");
        service.heartbeat(status.watchSessionId(), 77, "https://www.zhipin.com/web/geek/chat", "version", true, 1, "");
        when(store.beginCapture(1L, status.watchSessionId(), "scan", "capture-1")).thenReturn(false);

        var receipt = service.ingestScan(status.watchSessionId(), 77, "scan", 1, List.of(capture(1)));

        assertThat(receipt.duplicates()).isEqualTo(1);
        assertThat(service.status().scanRunning()).isTrue();
    }

    @Test
    void unreadCountWithoutAnySafeCaptureFailsClosed() {
        var status = service.start(77, "https://www.zhipin.com/web/geek/chat", "version", "browser-session");

        assertThatThrownBy(() -> service.ingestScan(status.watchSessionId(), 77, "scan", 16, List.of()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("未能安全识别");
    }

    private ChatCapture capture(int index) {
        String text = "消息" + index;
        ChatSession session = new ChatSession("uid-" + index, "security-" + index, "HR" + index,
                "公司" + index, "岗位" + index, "HR", text, "11:02");
        return new ChatCapture("capture-" + index, 1, session,
                List.of(new ChatMessage("对方", "文本", text, "11:02")));
    }

    private ProposalView proposal() {
        return new ProposalView(101L, 1L, 1L, "1234", "REVIEW_REQUIRED", "REPLY", "HR", "公司", "岗位",
                "消息", "您好", "普通消息", List.of(), List.of(), 0.9, 1,
                LocalDateTime.now().plusMinutes(15), LocalDateTime.now(), false);
    }
}
