package com.getjobs.application.service;

import com.microsoft.playwright.*;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import static org.assertj.core.api.Assertions.assertThat;

/** Actual browser input/click/outbound observation; all HR, backend and network data are synthetic. */
@Tag("browser")
class HrDutyBrowserRegressionTest {
    @Test void automaticReplyRunsBetweenCapturesAndUnknownDeliveryNeverBecomesSuccess() {
        try (Playwright playwright=Playwright.create();
             Browser browser=playwright.chromium().launch(new BrowserType.LaunchOptions().setChannel("chromium").setHeadless(true)
                     .setArgs(List.of("--disable-background-networking","--host-resolver-rules=MAP * ~NOTFOUND")))) {
            for(boolean confirm:List.of(true,false)) {
                try(BrowserContext context=browser.newContext()) {
                    context.route("**/*",route->route.abort());
                    String url="https://www.zhipin.com/web/geek/chat?getjobs-autopilot=1";
                    context.route(url,route->route.fulfill(new Route.FulfillOptions().setContentType("text/html").setBody("""
                        <!doctype html><meta charset="utf-8"><style>.friend-content,.message-item{display:block;min-height:30px}.chat-conversation{min-height:150px}textarea{width:200px;height:70px}</style>
                        <div class="user-list"><div class="friend-content-warp"><div class="friend-content"><span class="notice-badge">1</span><span class="name-box"><span class="name-text">测试HR</span><span>测试公司</span></span><span class="last-msg-text">您好</span><time>今天</time></div></div></div>
                        <div class="chat-conversation"><div class="user-info"><span class="name-text">测试HR</span><span>测试公司</span></div><div><ul class="im-list"><li class="message-item item-friend" data-mid="inbound"><span class="text">您好</span></li></ul></div><div class="history-tip">沟通从这里开始</div><textarea id="chat-input"></textarea><button>发送</button></div>
                        """)));
                    Page page=context.newPage();page.navigate(url);
                    page.evaluate("""
                        confirm=>{
                          const card=document.querySelector('.friend-content'),wrapper=card.parentElement,pane=document.querySelector('.chat-conversation');
                          const source={friendId:'101',friendSource:0,uniqueId:'101-0',name:'测试HR',brandName:'测试公司'};
                          wrapper.__vue__={$el:wrapper,$props:{source}};
                          card.onclick=()=>{card.classList.add('selected');pane.__vue__={$el:pane,selectedFriend$:source};};
                          const bind=()=>document.querySelectorAll('.message-item').forEach(row=>row.__vue__={$el:row,$props:{message:{mid:row.dataset.mid,messageType:'text'}}});bind();
                          window.fixtureClicks=0;window.fixtureReports=[];
                          document.querySelector('button').onclick=()=>{
                            fixtureClicks++;
                            if(confirm){const row=document.createElement('li');row.className='message-item item-myself';row.dataset.mid='outbound';const text=document.createElement('span');text.className='text';text.textContent=document.querySelector('textarea').value;row.append(text);document.querySelector('.im-list').append(row);bind();}
                          };
                          window.chrome={runtime:{onMessage:{addListener:fn=>window.fixtureListener=fn},sendMessage:(message,reply)=>{
                            if(message.operation==='hr-watch-guard'){reply({success:true,data:{data:{enabled:true,paused:false,authorizationValid:true,watchActive:true,version:2}}});return;}
                            if(message.operation==='hr-boundary-result'){fixtureReports.push(message.body);reply({success:true});return;}
                            if(message.type==='BOSS_HR_CAPTURE_RESULT'){
                              if(!message.capture.contextComplete)throw new Error('Incomplete fixture context');
                              reply({success:true,tabId:7,command:{commandId:'offline-command',leaseToken:'offline-lease',uid:'101-0',hrName:'测试HR',companyName:'测试公司',draft:'您好！',policyVersion:2,deadlineAt:Date.now()+30000,expectedInboundRound:message.capture.messages,expectedLatestInbound:message.capture.messages.at(-1)}});return;
                            }
                            reply({success:true});
                          }}};
                        }
                        """,confirm);
                    for(String script:List.of("boss-hr-identity.js","boss-hr-support.js","boss-hr-bridge.js"))
                        page.addScriptTag(new Page.AddScriptTagOptions().setPath(Path.of("chrome-extension",script)));
                    Object result=page.evaluate("""
                        ()=>new Promise(resolve=>fixtureListener({source:'GET_JOBS_BACKGROUND',type:'BOSS_HR_SCAN_V2',scanId:'offline',watchSessionId:'watch',scanAll:true,streamResults:true,managed:true,baseline:true,deadlineAt:Date.now()+30000},{},resolve))
                        """);
                    assertThat(((Map<?,?>)result).get("success")).isEqualTo(true);
                    assertThat(page.evaluate("fixtureClicks")).isEqualTo(1);
                    assertThat(page.evaluate("fixtureReports.length")).isEqualTo(1);
                    assertThat(page.evaluate("fixtureReports[0].outcome")).isEqualTo(confirm?"SENT":"RESULT_UNKNOWN");
                    assertThat(page.locator("textarea").inputValue()).isEqualTo("您好！");
                }
            }
        }
    }
}
