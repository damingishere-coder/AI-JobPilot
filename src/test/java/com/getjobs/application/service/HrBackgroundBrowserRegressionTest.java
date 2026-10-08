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

    @Test void productionPanelRendersAnalysisBlockerAcrossCollapseAndClearsItAfterReadRecovery() {
        try (Playwright pw=Playwright.create(); Browser browser=pw.chromium().launch(
                new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                        .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")));
             BrowserContext context=browser.newContext(new Browser.NewContextOptions().setViewportSize(1280,900))) {
            Page page=fixture(context);
            page.evaluate("""
                ()=>{
                  const attach=Element.prototype.attachShadow;
                  Element.prototype.attachShadow=function(options){return attach.call(this,{...options,mode:'open'});};
                  window.panelWarning='有 2 条聊天记录处理受阻，尚未发送回复。';
                  chrome.runtime.sendMessage=(message,reply)=>{
                    const binding={watchSessionId:'watch',hostGeneration:'generation',pageDocumentId:'document'};
                    const status={transport:'CHROME_BACKGROUND',watching:true,currentProfileId:1,currentProfileName:'合成档案',...binding,
                      activity:{background:{blockedCaptures:panelWarning?2:0,message:panelWarning}}};
                    const host={transport:'CHROME_BACKGROUND',state:'RUNNING',intentEnabled:true,profileId:1,...binding};
                    const policy={enabled:true,authorizationValid:true,replyMode:'AUTO',historyMode:'NEW_ONLY',historyDays:15};
                    const data=message.operation==='hr-status'?status:message.operation==='hr-background-status'?host:
                      message.operation==='hr-autopilot'?policy:[];
                    reply({success:true,data:{success:true,data}});
                  };
                }
                """);
            page.addScriptTag(new Page.AddScriptTagOptions().setPath(Path.of("chrome-extension","boss-hr-assistant.js")));
            page.waitForFunction("()=>document.getElementById('getjobs-boss-hr-assistant')?.shadowRoot?.textContent.includes('巡检中，部分回复受阻')");
            var root=page.locator("#getjobs-boss-hr-assistant");
            assertThat(root.locator(".error").innerText()).contains("尚未发送");
            assertThat(root.locator(".dot.on").count()).isZero();
            assertThat(root.locator("details.records").getAttribute("open")).isNull();
            String imagePath=System.getenv("BOSS_PANEL_TEST_IMAGE");
            if(imagePath!=null && !imagePath.isBlank())page.screenshot(new Page.ScreenshotOptions().setPath(Path.of(imagePath)));
            root.getByRole(com.microsoft.playwright.options.AriaRole.BUTTON,new Locator.GetByRoleOptions().setName("收起").setExact(true)).click();
            assertThat(root.locator(".body").isVisible()).isFalse();
            root.getByRole(com.microsoft.playwright.options.AriaRole.BUTTON,new Locator.GetByRoleOptions().setName("展开").setExact(true)).click();
            assertThat(root.locator(".error").isVisible()).isTrue();
            page.evaluate("panelWarning=''");
            root.getByRole(com.microsoft.playwright.options.AriaRole.BUTTON,new Locator.GetByRoleOptions().setName("立即刷新").setExact(true)).click();
            page.waitForFunction("()=>document.getElementById('getjobs-boss-hr-assistant').shadowRoot.textContent.includes('后台托管：运行中')");
            assertThat(root.locator(".error").count()).isZero();
            assertThat(page.evaluate("fixtureDispatches")).isEqualTo(0);
        }
    }

    @Test void patrolFiltersBeforeOpeningAndReadsChangedIncomingInProductionDom() {
        try (Playwright pw=Playwright.create(); Browser browser=pw.chromium().launch(
                new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                        .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")));
             BrowserContext context=browser.newContext()) {
            Page chat=fixture(context);
            chat.addScriptTag(new Page.AddScriptTagOptions().setPath(Path.of("chrome-extension","boss-hr-host.js")));
            chat.evaluate("""
                ()=>{
                  const card=document.querySelector('.friend-content'),open=card.onclick;
                  window.patrolOpens=0;window.oldOpens=0;window.patrolCaptures=[];window.patrolNow=Date.now();
                  card.onclick=()=>{patrolOpens++;open();};
                  const wrapper=document.createElement('div');wrapper.className='friend-content-warp';
                  wrapper.innerHTML='<div class="friend-content"><span class="name-box"><span class="name-text">旧HR</span><span>旧公司</span></span><span class="last-msg-text">两个月前的消息</span><time>1900-01-01</time></div>';
                  wrapper.__vue__={$el:wrapper,$props:{source:{friendId:'102',friendSource:0,uniqueId:'102-0',name:'旧HR',brandName:'旧公司'}}};
                  wrapper.firstChild.onclick=()=>oldOpens++;document.querySelector('.user-list').append(wrapper);
                  const storage={};let session=null;
                  const chrome={storage:{local:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,structuredClone(value))}},
                    alarms:{create:async()=>{},clear:async()=>{}},tabs:{query:async()=>[{id:1,windowId:1,url:location.href,status:'complete'}],
                      get:async()=>({id:1,windowId:1,url:location.href,status:'complete'}),update:async()=>{},
                      sendMessage:async(id,payload)=>new Promise(resolve=>fixtureListener(payload,{},resolve))},windows:{}};
                  const response=data=>({success:true,httpStatus:200,data:{data}});
                  const request=async(path,config)=>{
                    if(path.endsWith('/autopilot'))return response({enabled:true,paused:false,replyMode:'AUTO',authorizationValid:true,historyMode:'RECENT',historyDays:15});
                    if(path.endsWith('/status'))return response(session || {watching:false});
                    if(path.endsWith('/watch/start')){session={watching:true,watchSessionId:'watch',hostGeneration:config.body.hostGeneration,pageDocumentId:config.body.pageDocumentId,profileId:1};return response(session);}
                    if(path.endsWith('/watch/heartbeat'))return response({});
                    if(path.endsWith('/watch/legacy-anchors'))return response([{conversationId:132,status:'READ_ONLY'}]);
                    if(path.endsWith('/send-commands/claim'))return response(null);
                    if(path.endsWith('/watch/captures')){patrolCaptures.push(config.body.captures[0]);return response({accepted:true,captureId:config.body.captures[0].captureId});}
                    throw Error('unexpected endpoint '+path);
                  };
                  window.patrolHost=GetJobsBossHrHost.create({chrome,request,ensureContent:async()=>{},now:()=>patrolNow,setTimer:()=>1,clearTimer:()=>{}});
                  return patrolHost.control({type:'BOSS_HR_HOST_START',expectedProfileId:1,hrBackgroundProtocol:'2026-09-30-hr-background-v1',accountBindingConfirmed:true},{tab:{windowId:1}});
                }
                """);
            chat.evaluate("()=>patrolHost.tick()");
            assertThat(chat.evaluate("patrolOpens")).as("host state: %s",chat.evaluate("()=>patrolHost.read()")).isEqualTo(1);
            assertThat(chat.evaluate("oldOpens")).isEqualTo(0);
            assertThat(chat.evaluate("patrolCaptures.length")).isEqualTo(1);
            chat.evaluate("patrolNow+=31*60000");
            chat.evaluate("()=>patrolHost.tick()");chat.evaluate("()=>patrolHost.tick()");
            assertThat(chat.evaluate("patrolOpens")).isEqualTo(1);
            assertThat(chat.evaluate("oldOpens")).isEqualTo(0);
            chat.evaluate("""
                ()=>{patrolNow+=31*60000;document.querySelector('.last-msg-text').textContent='新提问';
                  const row=document.querySelector('.im-list .message-item');row.querySelector('.text').textContent='新提问';
                  row.dataset.mid='new-inbound';row.__vue__.$props.message.mid='new-inbound';}
                """);
            chat.evaluate("()=>patrolHost.tick()");chat.evaluate("()=>patrolHost.tick()");
            assertThat(chat.evaluate("patrolOpens")).isEqualTo(2);
            assertThat(chat.evaluate("oldOpens")).isEqualTo(0);
            assertThat(chat.evaluate("patrolCaptures.length")).isEqualTo(2);
            assertThat(chat.evaluate("fixtureDispatches")).isEqualTo(0);
        }
    }

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

    @Test void nativeDivSendControlWithContenteditableSubmitsExactlyOnce() {
        try(Playwright pw=Playwright.create();Browser browser=pw.chromium().launch(new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")));BrowserContext context=browser.newContext()) {
            Page chat=fixture(context);
            chat.evaluate("""
                ()=>{const old=document.querySelector('#send'),handler=old.onclick,send=document.createElement('div');
                  send.id='send';send.className='send-message';send.textContent='发送';send.onclick=handler;old.replaceWith(send);
                  const input=document.querySelector('#chat-input'),editor=document.createElement('div');editor.id='chat-input';
                  editor.contentEditable='true';editor.style.cssText='width:200px;height:70px';input.replaceWith(editor);
                  window.syntheticEnter=0;editor.addEventListener('keydown',()=>syntheticEnter++);
                  const outside=document.createElement('button');outside.textContent='发送';document.body.append(outside);}
                """);
            Map<?,?> ping=call(chat,Map.of("type","BOSS_HR_HOST_PAGE_PING"));
            call(chat,Map.of("type","BOSS_HR_HOST_BIND","protocol",PROTOCOL,"hostGeneration","generation","watchSessionId","watch","documentId",ping.get("documentId"),"explicitResume",true));
            Map<?,?> sent=send(chat,ping,Map.of("messages",List.of(Map.of("from","对方","type","文本","text","您好","time","","messageId","inbound"))),"generation");
            assertThat(sent.get("outcome")).isEqualTo("SENT");assertThat(chat.evaluate("fixtureClicks")).isEqualTo(1);
            assertThat(chat.evaluate("fixtureDispatches")).isEqualTo(1);assertThat(chat.evaluate("syntheticEnter")).isEqualTo(0);
            assertThat(chat.locator("[data-mid='outbound'] .text").textContent()).isEqualTo("您好！\n谢谢联系。");
        }
    }

    @Test void missingAmbiguousAndDisabledControlsNeverTriggerSyntheticEnterOrAClick() {
        try(Playwright pw=Playwright.create();Browser browser=pw.chromium().launch(new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")));BrowserContext context=browser.newContext()) {
            for(String mode:List.of("missing","duplicate","disabled")) {
                Page chat=fixture(context);chat.evaluate("""
                    mode=>{const send=document.querySelector('#send');if(mode==='missing')send.remove();
                      if(mode==='duplicate')send.after(send.cloneNode(true));if(mode==='disabled')send.setAttribute('aria-disabled','true');
                      window.syntheticEnter=0;document.querySelector('#chat-input').addEventListener('keydown',()=>syntheticEnter++);}
                    """,mode);
                Map<?,?> ping=call(chat,Map.of("type","BOSS_HR_HOST_PAGE_PING"));
                call(chat,Map.of("type","BOSS_HR_HOST_BIND","protocol",PROTOCOL,"hostGeneration","generation","watchSessionId","watch","documentId",ping.get("documentId"),"explicitResume",true));
                Map<?,?> sent=send(chat,ping,Map.of("messages",List.of(Map.of("from","对方","type","文本","text","您好","time","","messageId","inbound"))),"generation");
                assertThat(sent.get("outcome")).as(mode).isEqualTo("FAILED_SAFE");assertThat(chat.evaluate("fixtureClicks")).isEqualTo(0);assertThat(chat.evaluate("syntheticEnter")).isEqualTo(0);
                if(!mode.equals("disabled")){assertThat(chat.locator("textarea").inputValue()).isEmpty();assertThat(chat.evaluate("fixtureDispatches")).isEqualTo(0);}
                chat.close();
            }
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
                const text=document.createElement('span');text.className='text';const input=document.querySelector('#chat-input');text.textContent='value' in input?input.value:input.textContent;row.append(text);document.querySelector('.im-list').append(row);bind();
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
