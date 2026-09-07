package com.getjobs.application.service;

import com.getjobs.application.hr.HrAssistantTypes.*;
import org.junit.jupiter.api.Test;
import java.util.List;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class HrMediaServiceTest {
    final AiService ai=mock(AiService.class);
    final LocalResumeParserService parser=mock(LocalResumeParserService.class);
    final HrMediaService service=new HrMediaService(ai,parser);
    ChatCapture capture(String mime,String status) {
        return new ChatCapture("capture",1,null,List.of(
            new ChatMessage("本人","文本","您好","", "m1",List.of()),
            new ChatMessage("对方","图片","","","m2",List.of(new MediaContent("附件",mime,"data:"+mime+";base64,dGVzdA==","",status,"伪造解析")))),false,true);
    }
    @Test void imageNeedsRealExtractionRatherThanClientReadStatus() {
        when(ai.readImages(anyList(),anyString())).thenReturn("工作地点：深圳");
        var result=service.resolve(capture("image/png","READABLE"));
        assertThat(result.messages().getLast().media().getFirst().extractedText()).isEqualTo("工作地点：深圳");
        assertThat(HrMediaService.complete(result)).isTrue();verify(ai).readImages(anyList(),anyString());
    }
    @Test void providerFailureIsExplicitAndDoesNotDiscardOriginal() {
        when(ai.readImages(anyList(),anyString())).thenThrow(new IllegalStateException("offline"));
        var result=service.resolve(capture("image/png","CAPTURED"));
        assertThat(HrMediaService.complete(result)).isFalse();
        assertThat(result.messages().getLast().media().getFirst().dataUrl()).isEqualTo("data:image/png;base64,dGVzdA==");
    }
    @Test void unsupportedAudioRemainsPlayableButRequiresHuman() {
        var result=service.resolve(capture("audio/mpeg","CAPTURED"));
        assertThat(HrMediaService.complete(result)).isFalse();verifyNoInteractions(ai,parser);
        assertThat(result.messages().getLast().media().getFirst().extractedText()).contains("语音转写");
    }
    @Test void documentWarningsAreNotSilentlyAcceptedAsComplete() {
        when(parser.parse(any(),eq(".pdf"))).thenReturn(new LocalResumeParserService.LocalParseOutput("部分文字","test",1,List.of("部分页面未识别")));
        assertThat(HrMediaService.complete(service.resolve(capture("application/pdf","CAPTURED")))).isFalse();
    }
    @Test void unreadableOrCroppedImageNeedsHuman() {
        when(ai.readImages(anyList(),anyString())).thenReturn("UNREADABLE");
        assertThat(HrMediaService.complete(service.resolve(capture("image/png","CAPTURED")))).isFalse();
    }
}
