package com.getjobs.application.service;

import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import java.nio.file.*;
import java.util.*;
import static org.assertj.core.api.Assertions.assertThat;

/** Real Chromium layout and MV3 injection, using only synthetic fixtures. */
@Tag("browser")
class BrowserRuntimeRegressionTest {
    @TempDir Path temp;
    Playwright playwright;
    BrowserContext context;
    Page worker;
    Page page;
    com.sun.net.httpserver.HttpServer api;

    @BeforeEach void start(TestInfo testInfo) throws Exception {
        Path extension = temp.resolve("extension");
        Path source = Path.of("chrome-extension").toAbsolutePath();
        try (var files = Files.walk(source)) {
            for (Path file : files.filter(Files::isRegularFile).toList()) {
                Path relative = source.relativize(file);
                if (relative.startsWith("tests")) continue;
                Path target = extension.resolve(relative);
                Files.createDirectories(target.getParent());
                Files.copy(file, target);
            }
        }
        // Service-worker fetch is not reliably intercepted by page routing. Deny it
        // before the actual background script starts, including localhost production.
        Path background = extension.resolve("background.js");
        Files.writeString(background, "globalThis.fetch = async () => { throw new Error('OFFLINE_REGRESSION_NETWORK_DENIED'); };\n"
            + Files.readString(background));
        if (testInfo.getTestMethod().orElseThrow().getName().equals("bossColdPreflightNavigatesAndSendsOneMultilineGreetingAcrossDocuments")) {
            // Test-only bridge into the real MV3 worker; never copied to production.
            Files.writeString(background, """
              \nconst fixtureReceipts=[];
              // Chrome-created tabs can navigate before Playwright attaches its
              // route interceptor. Hand the blank tab to the test before navigation.
              const fixtureCreateTab=chrome.tabs.create.bind(chrome.tabs);
              chrome.tabs.create=options=>{
                if(options.url!=='https://www.zhipin.com/')throw new Error('UNEXPECTED_FIXTURE_TAB');
                return fixtureCreateTab({...options,url:'about:blank'});
              };
              globalThis.fetch=async(url,options={})=>{
                const parsed=new URL(url);let body;
                if(parsed.origin!=='http://127.0.0.1:6866')throw new Error('OFFLINE_NETWORK_DENIED');
                if(parsed.pathname==='/api/local-auth/action-token')body={success:true,data:{token:'offline-token'}};
                else if(parsed.pathname.endsWith('/validate-dispatch'))body={success:true};
                else if(parsed.pathname.endsWith('/runtime/claim'))body={success:true,enabled:false};
                else if(parsed.pathname==='/api/boss/jobs/10/delivery-result'){
                  const result=JSON.parse(options.body);fixtureReceipts.push(result);body={success:true,accepted:true,state:result.outcome};
                } else throw new Error('UNEXPECTED_OFFLINE_API:'+parsed.pathname);
                return new Response(JSON.stringify(body),{status:200,headers:{'Content-Type':'application/json'}});
              };
              chrome.runtime.onMessage.addListener((message,sender,reply)=>{
                if(message.type!=='OFFLINE_REGRESSION_REQUEST')return;
                if(message.receipts){reply(fixtureReceipts);return;}
                chrome.tabs.query({}).then(tabs=>{
                  const owner=tabs.find(t=>t.url==='http://localhost:6866/offline-regression');
                  return handlePageMessage(message.payload,{tab:owner});
                }).then(reply,error=>reply({fixtureError:error.message}));
                return true;
              });
              """, StandardOpenOption.APPEND);
        }
        Files.writeString(extension.resolve("regression-probe.html"), "<!doctype html><title>Offline regression</title><script src='browser-application-runtime.js'></script>");
        playwright = Playwright.create();
        context = playwright.chromium().launchPersistentContext(temp.resolve("profile"),
            new BrowserType.LaunchPersistentContextOptions().setChannel("chromium").setHeadless(true)
                .setArgs(List.of("--disable-extensions-except=" + extension, "--load-extension=" + extension,
                    "--disable-background-networking",
                    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1")));
        context.setDefaultTimeout(10000);
        context.route("**/*", route -> {
            if (route.request().url().startsWith("chrome-extension://")) route.resume();
            else route.abort();
        });
        var manifest = new com.fasterxml.jackson.databind.ObjectMapper().readTree(Files.readString(extension.resolve("manifest.json")));
        byte[] hash = java.security.MessageDigest.getInstance("SHA-256").digest(Base64.getDecoder().decode(manifest.get("key").asText()));
        var id = new StringBuilder();
        for (int i = 0; i < 16; i++) { id.append((char)('a' + ((hash[i] & 255) >> 4))); id.append((char)('a' + (hash[i] & 15))); }
        worker = context.newPage();
        // Hosted Windows runners can need more than 10s to cold-start MV3. Keep
        // the ordinary 10s action timeout; only initial extension loading gets 30s.
        worker.navigate("chrome-extension://" + id + "/regression-probe.html",
            new Page.NavigateOptions().setTimeout(30000));
        worker.waitForFunction("() => !!globalThis.BrowserApplicationRuntime");
        page = context.newPage();
    }

    @AfterEach void stop() {
        if (context != null) context.close();
        if (playwright != null) playwright.close();
        if (api != null) api.stop(0);
    }

    void fixture(String platform, String name, String extra) throws Exception {
        String html = Files.readString(Path.of("chrome-extension/tests/fixtures", platform, name));
        String url = platform.equals("boss") ? "https://www.zhipin.com/job_detail/fixture10.html"
            : "https://jobs.zhaopin.com/fixture10.htm";
        page.route(url, route -> route.fulfill(new Route.FulfillOptions().setContentType("text/html")
            .setBody("<!doctype html><html><head><meta charset='utf-8'></head><body>" + html + extra + "</body></html>")));
        page.navigate(url);
        page.waitForLoadState();
        // The production content scripts are loaded in the extension isolated world.
        for (int i = 0; i < 40; i++) {
            if (Boolean.TRUE.equals(probe("return !!(globalThis.GetJobsBossPageEvidence || globalThis.GetJobsZhilianPageEvidence)"))) return;
            page.waitForTimeout(100);
        }
        throw new AssertionError("Production content script was not injected");
    }

    Object probe(String body) {
        // Function source originates in this test only, never in a fixture or website.
        return worker.evaluate("async url => { const tabs = await chrome.tabs.query({}); const tab = tabs.find(t => t.url === url); "
            + "const result = await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>{" + body + "}}); return result[0].result; }", page.url());
    }

    @Test void fixturePopupReportsMissingRootsAndIncompleteDetailAcrossRealInjection() throws Exception {
        fixture("boss", "detail/redacted-header-only-20260915.html", "");
        String original = page.locator("body").innerHTML();
        worker.navigate(worker.url().replace("regression-probe.html", "fixture-popup.html"));
        // Model the toolbar popup's active recruiting tab; all injection and exporter code stays real.
        worker.evaluate("url=>{const query=chrome.tabs.query.bind(chrome.tabs);chrome.tabs.query=async()=>"
            + "(await query({})).filter(tab=>tab.url===url);}", page.url());
        worker.locator("#capture").click();
        worker.getByText("未找到该类型的白名单结构", new Page.GetByTextOptions().setExact(false)).waitFor();
        assertThat(worker.locator("#download").isDisabled()).isTrue();
        worker.locator("#page-type").selectOption("JOB_DETAIL");
        worker.locator("#capture").click();
        worker.getByText("缺少职位描述（JD）", new Page.GetByTextOptions().setExact(false)).waitFor();
        var bundle = new com.fasterxml.jackson.databind.ObjectMapper().readTree(worker.locator("#preview").inputValue());
        assertThat(bundle.path("coverage").path("descriptions").asInt()).isZero();
        assertThat(bundle.path("provenance").path("redactionVersion").asText()).isEqualTo("structural-fixture/4");
        assertThat(worker.locator("#download").isDisabled()).isTrue();
        worker.locator("#reviewed").check();
        assertThat(worker.locator("#download").isEnabled()).isTrue();
        assertThat(page.locator("body").innerHTML()).isEqualTo(original);
    }

    @Test void bossColdPreflightNavigatesAndSendsOneMultilineGreetingAcrossDocuments() throws Exception {
        // Real MV3 background/content scripts and document navigation; all pages
        // and API responses are synthetic, with real recruitment network denied.
        String workbench = "http://localhost:6866/offline-regression";
        context.route(workbench, route -> route.fulfill(new Route.FulfillOptions().setContentType("text/html")
            .setBody("<!doctype html><meta charset='utf-8'><title>Offline workbench</title>")));
        context.route("https://www.zhipin.com/", route -> {
            try { Thread.sleep(2300); } catch (InterruptedException error) { Thread.currentThread().interrupt(); }
            route.fulfill(new Route.FulfillOptions().setContentType("text/html")
                .setBody("<!doctype html><meta charset='utf-8'><title>Offline BOSS</title><div>测试岗位首页</div>"));
        });
        context.route("https://www.zhipin.com/job_detail/fixture10.html", route -> route.fulfill(
            new Route.FulfillOptions().setContentType("text/html").setBody("""
              <!doctype html><meta charset='utf-8'><title>Offline job</title>
              <div class='job-detail'><h1 class='job-title'>测试岗位</h1><p>测试职责</p>
                <button onclick="sessionStorage.fixtureContactClicks=Number(sessionStorage.fixtureContactClicks||0)+1;location.href='/web/geek/chat'">立即沟通</button>
              </div>
              """)));
        context.route("https://www.zhipin.com/web/geek/chat", route -> route.fulfill(
            new Route.FulfillOptions().setContentType("text/html").setBody("""
              <!doctype html><meta charset='utf-8'><title>Offline chat</title>
              <div class='user-list'><div class='friend-content-warp'><div class='friend-content selected'>
                <div class='name-box'><span class='name-text'>测试HR</span><span>测试公司</span></div>
              </div></div></div>
              <div class='chat-conversation'><div class='im-list'></div>
                <div id='chat-input' class='chat-input' contenteditable='true' style='white-space:normal;min-height:40px'></div>
                <button class='btn-send'>发送</button>
              </div>
              <script>
                const props={friendId:'101',friendSource:0,uniqueId:'101-0',name:'测试HR',brandName:'测试公司',encryptJobId:'fixture10'};
                const card=document.querySelector('.friend-content-warp'),pane=document.querySelector('.chat-conversation');
                card.__vue__={$el:card,$props:{source:props}};pane.__vue__={$el:pane,selectedFriend$:props};
                document.querySelector('.btn-send').onclick=()=>{
                  sessionStorage.fixtureSendClicks=Number(sessionStorage.fixtureSendClicks||0)+1;
                  const input=document.getElementById('chat-input'),row=document.createElement('div');row.className='message-self';
                  const text=document.createElement('div');text.className='text-content';text.innerHTML=input.innerHTML;
                  row.append(text);document.querySelector('.im-list').append(row);input.innerHTML='';
                };
              </script>
              """)));
        page.navigate(workbench);
        assertThat(ping()).isEqualTo(true);
        Page landing = context.waitForPage(() -> worker.evaluate("""
          ()=>{window.fixturePreflight=chrome.runtime.sendMessage({type:'OFFLINE_REGRESSION_REQUEST',payload:{type:'BOSS_DELIVERY_PREFLIGHT',platform:'boss'}});}
          """));
        // The context now owns the tab and its routes before the first HTTPS request.
        landing.navigate("https://www.zhipin.com/");
        Object prepared = worker.evaluate("()=>window.fixturePreflight");
        assertThat(((Map<?,?>)prepared).get("success")).as("preflight: %s", prepared).isEqualTo(true);
        Object result = worker.evaluate("""
          ()=>chrome.runtime.sendMessage({type:'OFFLINE_REGRESSION_REQUEST',payload:{type:'BOSS_DELIVER_ONE',platform:'boss',runtimeProtocol:'application-runtime/1',
              runId:'fixture-run',runtimeSessionId:'fixture-session',correlationId:'fixture-correlation',
              task:{id:10,profileId:1,requestKey:'fixture-delivery',url:'https://www.zhipin.com/job_detail/fixture10.html',
                greeting:'测试岗位沟通。\\n个人作品集：https://example.invalid/'}}})
          """);
        assertThat(((Map<?,?>)result).get("outcome")).as("delivery: %s", result).isEqualTo("CONFIRMED");
        assertThat(((Map<?,?>)result).get("greetingOutcome")).isEqualTo("CONFIRMED");
        Page chat = context.pages().stream().filter(p -> p.url().equals("https://www.zhipin.com/web/geek/chat")).findFirst().orElseThrow();
        assertThat(chat.locator(".message-self").count()).isEqualTo(1);
        assertThat(chat.locator(".text-content").innerText()).isEqualTo("测试岗位沟通。\n个人作品集：https://example.invalid/");
        assertThat(chat.evaluate("() => [sessionStorage.fixtureContactClicks,sessionStorage.fixtureSendClicks]"))
            .isEqualTo(List.of("1","1"));
        assertThat(worker.evaluate("async() => {const receipts=await chrome.runtime.sendMessage({type:'OFFLINE_REGRESSION_REQUEST',receipts:true});return receipts.length > 0 && receipts.every(r=>r.outcome==='CONFIRMED' && r.greetingOutcome==='CONFIRMED') }"))
            .isEqualTo(true);
    }

    @Test void bossGreetingKeepsNewlinesInTheRealContenteditable() throws Exception {
        fixture("boss", "detail/redacted-header-only-20260915.html",
            "<div id='chat-input' contenteditable='true' style='white-space:normal'></div>");
        String source = Files.readString(Path.of("chrome-extension/boss-content.js"));
        String functions = source.substring(source.indexOf("  function writeChatInput("),
            source.indexOf("  function findSendButton("));
        assertThat(probe(functions + """
            function isCurrentContentInstance() { return true; }
            const input = document.getElementById('chat-input');
            const expected = '测试岗位沟通。\\n个人作品集：https://example.invalid/';
            writeChatInput(input, expected);
            return readChatInput(input);
            """)).isEqualTo("测试岗位沟通。\n个人作品集：https://example.invalid/");
    }

    @Test void realLayoutRejectsHiddenSuccessAndQuotaOverridesVisibleSuccess() throws Exception {
        fixture("zhilian", "states/success.html", "");
        assertThat(probe("return GetJobsZhilianPageEvidence.detectStatus(document)")).isEqualTo("已投递");
        page.locator(".modal").evaluate("el => el.style.display='none'");
        assertThat(probe("return GetJobsZhilianPageEvidence.detectStatus(document)")).isEqualTo("");
        page.locator("body").evaluate("el => el.innerHTML='<button>已投递</button><div>今日投递次数已用完</div>'");
        assertThat(probe("const api=GetJobsZhilianPageEvidence; const state=api.observe({document,href:location.href}); return api.evaluateEvidence(document,state).outcome"))
            .isEqualTo("UNKNOWN");
    }

    @Test void fixedBossDialogIsVisibleWithoutOffsetParentAndBlocksActions() throws Exception {
        fixture("boss", "states/quota-exhausted.html", "<style>.dialog{position:fixed;inset:10px;width:300px;height:100px}</style>");
        assertThat(probe("return GetJobsBossPageEvidence.observe({document,href:location.href,styleReader:getComputedStyle}).blocker"))
            .isEqualTo("QUOTA_LIMIT");
        assertThat(probe("let calls=0; const result=await BrowserApplicationRuntime.beforeEffect({task:{runtime:{claimVersion:1}},"
            + "begin:async()=>{calls++;return {permitted:true}},observe:()=>GetJobsBossPageEvidence.observe({document,href:location.href,styleReader:getComputedStyle}),"
            + "matches:()=>true,active:()=>true}); return {calls,outcome:result.outcome}"))
            .isEqualTo(Map.of("calls",0,"outcome","UNKNOWN"));
    }

    @Test void reloadReinjectsProductionAdapterAndExtensionPageCannotReachProduction() throws Exception {
        fixture("zhilian", "detail/split.html", "");
        assertThat(worker.evaluate("async()=>{try{await fetch('http://127.0.0.1:6866/api/health');return false}catch(e){return true}}"))
            .isEqualTo(true);
        page.reload();
        page.waitForTimeout(300);
        assertThat(probe("return BrowserApplicationRuntime.version")).isEqualTo("browser-application-runtime/1");
        assertThat(probe("let calls=0;const result=await BrowserApplicationRuntime.beforeEffect({task:{reconciliationOnly:true,runtime:{}},begin:async()=>{calls++;return {permitted:true}}});return {calls,outcome:result.outcome}"))
            .isEqualTo(Map.of("calls",0,"outcome","UNKNOWN"));
    }

    @Test void bridgeReconnectsAfterMv3WorkerStopsWithoutStartingAnyDelivery() {
        String url = "http://localhost:6866/offline-regression";
        page.route(url, route -> route.fulfill(new Route.FulfillOptions().setContentType("text/html")
            .setBody("<!doctype html><meta charset='utf-8'><title>Offline workbench fixture</title>")));
        page.navigate(url);
        assertThat(ping()).isEqualTo(true);
        var cdp = context.newCDPSession(page);
        cdp.send("ServiceWorker.enable");
        cdp.send("ServiceWorker.stopAllWorkers");
        assertThat(ping()).isEqualTo(true);
        assertThat(context.pages()).hasSize(3); // Initial blank page, probe, and fixture only.
        cdp.detach();
    }

    Object ping() {
        return page.evaluate("""
            () => new Promise((resolve,reject)=>{
              const requestId=crypto.randomUUID();
              const timer=setTimeout(()=>{window.removeEventListener('message',listener);reject(new Error('Bridge ping timeout'));},5000);
              function listener(event){if(event.data?.requestId!==requestId || event.data?.source!=='GET_JOBS_EXTENSION')return;
                clearTimeout(timer);window.removeEventListener('message',listener);resolve(event.data.response?.success===true);}
              window.addEventListener('message',listener);
              window.postMessage({source:'GET_JOBS_PAGE',type:'GET_JOBS_EXTENSION_PING',requestId},location.origin);
            })
            """);
    }

    @Test void extensionRuntimeHttpAndSqliteKeepUnknownAcrossRestartAndDuplicateCallbacks() throws Exception {
        var ds = new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("runtime.db"));
        org.flywaydb.core.Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(ds);
        var manager = new org.springframework.jdbc.datasource.DataSourceTransactionManager(ds);
        var attempts = new DeliveryAttemptService(jdbc, manager);
        var runtime = new DeliveryRuntimeService(jdbc, attempts, manager, true);
        String jobUrl = "https://www.zhipin.com/job_detail/fixture10.html";
        String greeting = "离线测试专用，禁止真实发送。";
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'synthetic',1)");
        jdbc.update("INSERT INTO boss_data(id,profile_id,encrypt_id,job_url,delivery_status) VALUES(10,1,'fixture10',?,?)",jobUrl,DeliveryStatus.WAITING_CONFIRM);
        String key = attempts.requestBoss(10,1,"fixture10",false).requestKey();
        attempts.snapshotGreeting(key,greeting,"USER_EDITED");
        var json = new com.fasterxml.jackson.databind.ObjectMapper();
        api = com.sun.net.httpserver.HttpServer.create(new java.net.InetSocketAddress("127.0.0.1",0),0);
        api.createContext("/", exchange -> {
            try {
                exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
                exchange.getResponseHeaders().set("Access-Control-Allow-Headers", "Content-Type");
                if (exchange.getRequestMethod().equals("OPTIONS")) { exchange.sendResponseHeaders(204,-1); return; }
                String path = exchange.getRequestURI().getPath();
                byte[] input = exchange.getRequestBody().readAllBytes();
                Object result;
                if (path.endsWith("/claim")) result = runtime.claim(key,json.readValue(input,DeliveryRuntimeService.Claim.class));
                else if (path.endsWith("/begin")) result = runtime.begin(key,json.readValue(input,DeliveryRuntimeService.Begin.class));
                else if (path.equals("/result")) {
                    result = Map.of("accepted",attempts.resolveBoss(1L,10,key,DeliveryAttemptService.State.UNKNOWN,"NO_CONFIRMATION","synthetic lost callback",null,null,
                        DeliveryAttemptService.GreetingOutcome.UNKNOWN,"GREETING_UNCONFIRMED").accepted());
                } else { exchange.sendResponseHeaders(404,-1); return; }
                byte[] output = json.writeValueAsBytes(result);
                exchange.getResponseHeaders().set("Content-Type","application/json");
                exchange.sendResponseHeaders(200,output.length);
                exchange.getResponseBody().write(output);
            } catch(Exception error) { exchange.sendResponseHeaders(500,-1); }
            finally { exchange.close(); }
        });
        api.start();
        String origin = "http://127.0.0.1:" + api.getAddress().getPort();
        // Sole network exception: this test's ephemeral server, backed by @TempDir SQLite.
        worker.route(origin + "/**", route -> route.resume());
        Object result = worker.evaluate("""
            async input => {
              const post=async(path,body)=>(await fetch(input.origin+path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
              const task={requestKey:input.key,profileId:1,id:10,url:input.url,greeting:input.greeting};
              const message={runId:'fixture-run',runtimeSessionId:'fixture-session',correlationId:'fixture-correlation'};
              const claimed=await BrowserApplicationRuntime.claim({task,message,platform:'boss',pageTabId:1,ownerAlive:async()=>true,
                request:async(path,options)=>({success:true,data:await post(path,options.body)})});
              if(!claimed.task?.runtime) throw new Error('Fixture claim rejected');
              const args={task:claimed.task,begin:body=>post('/api/delivery-attempts/'+input.key+'/runtime/begin',body),
                observe:()=>({pageType:'JOB_DETAIL',blocker:'NONE'}),matches:()=>true,active:()=>true};
              let effects=0;
              if(await BrowserApplicationRuntime.beforeEffect(args)===null)effects++;
              if(await BrowserApplicationRuntime.beforeEffect(args)===null)effects++;
              await post('/result',{}); await post('/result',{});
              return effects;
            }
            """,Map.of("origin",origin,"key",key,"url",jobUrl,"greeting",greeting));
        assertThat(result).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT state FROM delivery_attempt WHERE request_key=?",String.class,key)).isEqualTo("UNKNOWN");
        assertThat(runtime.timeline(key)).extracting(row -> row.get("phase")).containsExactly("CLAIMED","EFFECT_POSSIBLE","UNKNOWN");
        var restarted = new DeliveryRuntimeService(jdbc,attempts,manager,true);
        assertThat(restarted.begin(key,new DeliveryRuntimeService.Begin(1,"fixture-session",1,"JOB_DETAIL","NONE"))).containsEntry("success",false);
        assertThat(attempts.prepareRecovery(key,1)).containsEntry("success",true);
    }
}
