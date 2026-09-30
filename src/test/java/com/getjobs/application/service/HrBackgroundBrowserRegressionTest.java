package com.getjobs.application.service;

import com.microsoft.playwright.*;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;

/** Production DOM bridge in isolated Chromium; no platform, AI or account network.
 * Headless Chromium does not implement tab visibility like headed Chrome. Extension
 * tests enforce inactive tab creation and real background acceptance remains separate. */
@Tag("browser")
class HrBackgroundBrowserRegressionTest {
    private static final String PROTOCOL="2026-09-30-hr-background-v1";

    @Test void isolatedPageReadsAndSendsOneExactReplyWithoutChangingOtherPage() {
        try (Playwright pw=Playwright.create(); Browser browser=pw.chromium().launch(
                new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                        .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")));
             BrowserContext context=browser.newContext()) {
            Page chat=fixture(context);
            Page foreground=context.newPage();foreground.setContent("<input id='work' value='用户正在其他页面工作'>");
            foreground.bringToFront();foreground.locator("#work").focus();
            Map<?,?> ping=call(chat,Map.of("type","BOSS_HR_HOST_PAGE_PING"));
            assertThat(ping.get("protocol")).isEqualTo(PROTOCOL);
            assertThat(ping.get("accountRole")).isEqualTo("GEEK");
            assertThat(call(chat,Map.of("type","BOSS_HR_HOST_BIND","protocol",PROTOCOL,
                    "hostGeneration","generation","watchSessionId","watch","documentId",ping.get("documentId"),"explicitResume",true)).get("success")).isEqualTo(true);
            Map<?,?> read=call(chat,Map.of("type","BOSS_HR_HOST_SCAN_STEP","protocol",PROTOCOL,
                    "hostGeneration","generation","watchSessionId","watch","documentId",ping.get("documentId"),
                    "cursor",Map.of("stage","CAPTURE","baseline",true),"target",Map.of("uid","101-0"),"deadlineAt",(double)(System.currentTimeMillis()+20000)));
            assertThat(read.get("success")).isEqualTo(true);
            Map<?,?> capture=(Map<?,?>)read.get("capture");
            assertThat(capture.get("contextComplete")).isEqualTo(true);
            Map<?,?> sent=send(chat,ping,capture,"generation");
            assertThat(sent.get("outcome")).isEqualTo("SENT");
            assertThat(chat.evaluate("fixtureClicks")).isEqualTo(1);
            assertThat(chat.evaluate("fixtureDispatches")).isEqualTo(1);
            assertThat(chat.evaluate("fixtureReports.length")).isEqualTo(1);
            assertThat(chat.evaluate("fixtureReports[0].outcome")).isEqualTo("SENT");
            assertThat(chat.evaluate("fixtureReports[0].observedCapture.messages.at(-1).text")).isEqualTo("您好！ 谢谢联系。");
            assertThat(chat.locator("[data-mid='outbound'] .text").textContent()).isEqualTo("您好！\n谢谢联系。");
            assertThat(foreground.evaluate("document.activeElement.id")).isEqualTo("work");
            assertThat(foreground.locator("#work").inputValue()).isEqualTo("用户正在其他页面工作");
        }
    }

    @Test void previousGenerationCannotTypeOrDispatchOnReboundPage() {
        try (Playwright pw=Playwright.create(); Browser browser=pw.chromium().launch(
                new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                        .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")));
             BrowserContext context=browser.newContext()) {
            Page chat=fixture(context);
            Map<?,?> ping=call(chat,Map.of("type","BOSS_HR_HOST_PAGE_PING"));
            call(chat,Map.of("type","BOSS_HR_HOST_BIND","protocol",PROTOCOL,"hostGeneration","new-generation",
                    "watchSessionId","watch","documentId",ping.get("documentId"),"explicitResume",true));
            Map<?,?> result=send(chat,ping,Map.of("messages",List.of(Map.of("from","对方","type","文本","text","您好","time",""))),"old-generation");
            assertThat(result.get("outcome")).isEqualTo("FAILED_SAFE");
            assertThat(chat.locator("textarea").inputValue()).isEmpty();
            assertThat(chat.evaluate("fixtureClicks")).isEqualTo(0);
            assertThat(chat.evaluate("fixtureDispatches")).isEqualTo(0);
        }
    }

    private Map<?,?> send(Page page,Map<?,?> ping,Map<?,?> capture,String generation) {
        Map<String,Object> command=new java.util.LinkedHashMap<>();
        command.putAll(Map.of("commandId","command","leaseToken","lease","uid","101-0","hrName","合成HR",
                "companyName","合成公司","draft","您好！\n谢谢联系。","policyVersion",2,"deadlineAt",(double)(System.currentTimeMillis()+20000)));
        command.put("hostGeneration",generation);command.put("pageDocumentId",ping.get("documentId"));command.put("watchSessionId","watch");
        command.put("expectedInboundRound",capture.get("messages"));
        command.put("expectedLatestInbound",((List<?>)capture.get("messages")).getLast());
        return call(page,Map.of("type","BOSS_HR_SEND_V2","command",command));
    }
    @SuppressWarnings("unchecked")
    private Map<?,?> call(Page page,Map<String,Object> payload) {
        return (Map<?,?>)page.evaluate("payload=>new Promise(resolve=>fixtureListener({source:'GET_JOBS_BACKGROUND',...payload},{},resolve))",payload);
    }
    private Page fixture(BrowserContext context) {
        context.route("**/*",route->route.abort());
        String url="https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1";
        context.route(url,route->route.fulfill(new Route.FulfillOptions().setContentType("text/html").setBody("""
            <!doctype html><meta charset="utf-8"><style>.friend-content,.message-item{display:block;min-height:30px}.chat-conversation{min-height:150px}textarea{width:200px;height:70px}</style>
            <div data-geek-account-name="合成求职者"></div><button class="active">全部</button><span>未读(1)</span>
            <div class="user-list"><div class="friend-content-warp"><div class="friend-content"><span class="notice-badge">1</span><span class="name-box"><span class="name-text">合成HR</span><span>合成公司</span></span><span class="last-msg-text">您好</span><time>今天</time></div></div></div>
            <div class="chat-conversation"><div class="user-info"><span class="name-text">合成HR</span><span>合成公司</span></div><div><ul class="im-list"><li class="message-item item-friend" data-mid="inbound"><span class="text">您好</span></li></ul></div><div class="history-tip">沟通从这里开始</div><textarea id="chat-input"></textarea><button id="send">发送</button></div>
            """)));
        Page page=context.newPage();page.navigate(url);
        page.evaluate("""
            ()=>{
              const card=document.querySelector('.friend-content'),wrapper=card.parentElement,pane=document.querySelector('.chat-conversation');
              const source={friendId:'101',friendSource:0,uniqueId:'101-0',name:'合成HR',brandName:'合成公司'};
              wrapper.__vue__={$el:wrapper,$props:{source}};
              card.onclick=()=>{card.classList.add('selected');pane.__vue__={$el:pane,selectedFriend$:source};};
              const bind=()=>document.querySelectorAll('.message-item').forEach(row=>row.__vue__={$el:row,$props:{message:{mid:row.dataset.mid,messageType:'text'}}});bind();
              window.fixtureClicks=0;window.fixtureDispatches=0;window.fixtureReports=[];
              document.querySelector('#send').onclick=()=>{
                fixtureClicks++;const row=document.createElement('li');row.className='message-item item-myself';row.dataset.mid='outbound';
                const text=document.createElement('span');text.className='text';text.textContent=document.querySelector('textarea').value;row.append(text);document.querySelector('.im-list').append(row);bind();
              };
              window.chrome={runtime:{onMessage:{addListener:fn=>window.fixtureListener=fn},sendMessage:(message,reply)=>{
                if(message.type==='BOSS_HR_HOST_GUARD'){reply({success:true,watchActive:true,policyVersion:2});return;}
                if(message.type==='BOSS_HR_HOST_DISPATCH'){fixtureDispatches++;reply({success:true});return;}
                if(message.type==='BOSS_HR_HOST_RESULT'){fixtureReports.push(message);reply({success:true});return;}
                reply({success:true});
              }}};
            }
            """);
        for(String script:List.of("boss-hr-identity.js","boss-hr-support.js","boss-hr-bridge.js"))
            page.addScriptTag(new Page.AddScriptTagOptions().setPath(Path.of("chrome-extension",script)));
        return page;
    }
}
