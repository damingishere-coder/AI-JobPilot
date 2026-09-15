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

    @BeforeEach void start() throws Exception {
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
        Files.writeString(extension.resolve("regression-probe.html"), "<!doctype html><title>Offline regression</title><script src='browser-application-runtime.js'></script>");
        playwright = Playwright.create();
        context = playwright.chromium().launchPersistentContext(temp.resolve("profile"),
            new BrowserType.LaunchPersistentContextOptions().setChannel("chromium").setHeadless(true)
                .setArgs(List.of("--disable-extensions-except=" + extension, "--load-extension=" + extension,
                    "--disable-background-networking")));
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
        worker.navigate("chrome-extension://" + id + "/regression-probe.html");
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
        assertThat(bundle.path("provenance").path("redactionVersion").asText()).isEqualTo("structural-fixture/2");
        assertThat(worker.locator("#download").isDisabled()).isTrue();
        worker.locator("#reviewed").check();
        assertThat(worker.locator("#download").isEnabled()).isTrue();
        assertThat(page.locator("body").innerHTML()).isEqualTo(original);
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
