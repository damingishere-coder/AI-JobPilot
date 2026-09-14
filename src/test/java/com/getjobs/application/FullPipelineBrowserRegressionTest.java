package com.getjobs.application;

import com.fasterxml.jackson.databind.*;
import com.getjobs.application.init.ZhilianOptionInitializer;
import com.getjobs.application.service.*;
import com.microsoft.playwright.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.*;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import java.net.URI;
import java.net.http.*;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real extension and Spring HTTP pipeline. Recruiting pages, user confirmation UI and AI are fixtures. */
@Tag("browser")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "app.auto-open-browser=false","app.browser.initialize-on-startup=false","app.static-server.enabled=false",
    "application.runtime.boss-enabled=true"
})
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class FullPipelineBrowserRegressionTest {
    static final ObjectMapper JSON=new ObjectMapper();
    static final Path ROOT=createRoot();
    static final String JOB_URL="https://www.zhipin.com/job_detail/pipeline-fixture.html";
    static final String GREETING="您好，我有 Java 和 Spring Boot 后端经验，希望进一步了解该岗位的系统设计工作。";
    @DynamicPropertySource static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url",()->"jdbc:sqlite:"+ROOT.resolve("pipeline.db"));
        registry.add("app.hr-assistant.key-path",()->ROOT.resolve("fixture.key").toString());
        for(String folder:List.of("data","output","cache","log")) registry.add("app.paths."+folder+"-dir",()->ROOT.resolve(folder).toString());
        registry.add("logging.file.name",()->ROOT.resolve("log/test.log").toString());
    }
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @Autowired GreetingDraftService greetings;
    @MockitoBean ZhilianOptionInitializer options;
    @MockitoBean AiService ai;
    @MockitoBean CodexCliService cli;
    Playwright playwright;BrowserContext browser;Page extension;Page job;Page workbench;
    String origin;AtomicInteger aiCalls=new AtomicInteger();

    @BeforeEach void setup() throws Exception {
        origin="http://127.0.0.1:"+port;
        assertThat(port).isNotEqualTo(6866);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'Offline fixture',1)");
        jdbc.update("INSERT INTO resume_profile(profile_id,resume_text,parse_status) VALUES(1,?,'SUCCESS')","Java 和 Spring Boot 后端开发、系统设计经验。北京，本科，3-5年，15-25K。");
        jdbc.update("INSERT INTO boss_config(profile_id,native_greeting_disabled_confirmed,say_hi) VALUES(1,1,?)",GREETING);
        when(ai.sendStructuredRequest(anyString(),anyString(),anyString())).thenAnswer(invocation->{
            aiCalls.incrementAndGet();
            var results=new ArrayList<Map<String,Object>>();
            for(Long id:jdbc.queryForList("SELECT id FROM job_analysis_task WHERE status='LEASED'",Long.class)) {
                var dimensions=new ArrayList<Map<String,Object>>();
                for(String key:List.of("CORE_SKILLS","RELEVANT_EXPERIENCE","ACHIEVEMENTS_COMPLEXITY","INDUSTRY_TRANSFER","EDUCATION_TENURE","LOCATION_SALARY"))
                    dimensions.add(Map.of("key",key,"status","MATCH","jobEvidence",List.of("Java"),"resumeEvidence",List.of("Java"),"note","虚构资料双方原文证据"));
                results.add(Map.of("taskId",id,"summary","虚构岗位匹配","matches",List.of("双方提到 Java"),"gaps",List.of(),"unknowns",List.of(),"dimensions",dimensions,"hardConflicts",List.of(),"greeting",GREETING));
            }
            return JSON.writeValueAsString(Map.of("results",results));
        });
        Path copy=ROOT.resolve("extension");Path source=Path.of("chrome-extension").toAbsolutePath();
        try(var files=Files.walk(source)) {
            for(Path file:files.filter(Files::isRegularFile).toList()) {
                Path relative=source.relativize(file);if(relative.startsWith("tests")) continue;
                Path target=copy.resolve(relative);Files.createDirectories(target.getParent());
                if(file.toString().endsWith(".js")||file.toString().endsWith(".json")) Files.writeString(target,Files.readString(file).replace("6866",String.valueOf(port)));
                else Files.copy(file,target);
            }
        }
        // Worker requests bypass Playwright page routing: allow this isolated server only, before background starts.
        String guard="const nativeFetch=globalThis.fetch.bind(globalThis);globalThis.fetch=(input,options)=>{const url=typeof input==='string'?input:input.url;if(new URL(url).origin!=="
            +JSON.writeValueAsString(origin)+")throw new Error('OFFLINE_NETWORK_DENIED');return nativeFetch(input,options);};\n";
        // The Java Playwright version has no service-worker handle. This temporary-only hook
        // calls the production dispatch/claim helpers without starting platform clicks.
        String hook="\nchrome.runtime.onMessage.addListener((message,sender,respond)=>{if(message.type!=='OFFLINE_PIPELINE_CLAIM')return false;"
            +"(async()=>{try{await validateConfirmedTask(message.task,'boss',message.owner);respond(await claimRuntimeTask(message.task,{runId:'fixture-confirm',runtimeSessionId:'fixture-session',correlationId:'fixture-correlation'},'boss',message.owner));}catch(error){respond({testError:error.message});}})();return true;});";
        Path background=copy.resolve("background.js");Files.writeString(background,guard+Files.readString(background)+hook);
        Files.writeString(copy.resolve("probe.js"),guard);
        Files.writeString(copy.resolve("pipeline.html"),"<!doctype html><script src='probe.js'></script><script src='browser-application-runtime.js'></script>");
        playwright=Playwright.create();
        browser=playwright.chromium().launchPersistentContext(ROOT.resolve("browser"),new BrowserType.LaunchPersistentContextOptions()
            .setChannel("chromium").setHeadless(true).setArgs(List.of("--disable-extensions-except="+copy,"--load-extension="+copy,"--disable-background-networking")));
        browser.setDefaultTimeout(12000);
        browser.route("**/*",route->{String url=route.request().url();if(url.startsWith("chrome-extension://")||URI.create(url).getAuthority().equals("127.0.0.1:"+port)) route.resume();else route.abort();});
        byte[] hash=java.security.MessageDigest.getInstance("SHA-256").digest(Base64.getDecoder().decode(JSON.readTree(Files.readString(copy.resolve("manifest.json"))).path("key").asText()));
        StringBuilder id=new StringBuilder();for(int i=0;i<16;i++){id.append((char)('a'+((hash[i]&255)>>4)));id.append((char)('a'+(hash[i]&15)));}
        extension=browser.newPage();extension.navigate("chrome-extension://"+id+"/pipeline.html");
        workbench=browser.newPage();workbench.route(origin+"/offline-confirm",route->route.fulfill(new Route.FulfillOptions().setContentType("text/html").setBody("<!doctype html><meta charset='utf-8'><button id='confirm'>确认虚构岗位</button><output id='result'></output>")));
        workbench.navigate(origin+"/offline-confirm");
        job=browser.newPage();String html=Files.readString(Path.of("chrome-extension/tests/fixtures/boss/detail/full.html"))
            .replace("AI产品运营","Java后端工程师").replace("负责产品需求分析、运营推广和数据跟踪。任职要求：熟悉人工智能产品并具备项目交付经验。","Java 和 Spring Boot 后端开发、系统设计。任职要求：Java 项目交付经验。");
        job.route(JOB_URL,route->route.fulfill(new Route.FulfillOptions().setContentType("text/html").setBody("<!doctype html><meta charset='utf-8'>"+html)));
        job.navigate(JOB_URL);
        await(()->Boolean.TRUE.equals(probe("return !!globalThis.GetJobsBossDetailCollector")));
    }

    @AfterEach void stop() {if(browser!=null) browser.close();if(playwright!=null) playwright.close();}

    @Test void collectAnalyzeConfirmApplyCallbackAndReloadStaySingleAttempt() throws Exception {
        assertThat(extension.evaluate("async()=>{try{await fetch('http://127.0.0.1:6866/api/health');return false}catch(e){return true}} ")).isEqualTo(true);
        String collect="const detail=GetJobsBossDetailCollector.collectCurrentDetail();return await chrome.runtime.sendMessage({source:'GET_JOBS_BOSS_CONTENT',type:'BOSS_LOCAL_API',operation:'chrome-jobs',body:{profileId:1,runId:'fixture-discovery',keyword:'Java',autoDeliver:true,jobs:[{...detail,id:'pipeline-fixture',url:location.href,detailVerified:true}]}});";
        JsonNode accepted=tree(probe(collect));assertThat(accepted.path("success").asBoolean()).withFailMessage(accepted.toString()).isTrue();
        await(()->count("SELECT COUNT(*) FROM job_analysis_task WHERE status='SUCCEEDED'")==1);
        assertThat(aiCalls.get()).isEqualTo(1);assertThat(count("SELECT COUNT(*) FROM delivery_attempt")).isZero();
        assertThat(jdbc.queryForObject("SELECT delivery_status FROM boss_data",String.class)).isEqualTo("待确认");
        long row=jdbc.queryForObject("SELECT id FROM boss_data",Long.class);
        // Even the legacy autoDeliver flag above cannot authorize an attempt; stale preview cannot either.
        assertThat(http("/api/boss/jobs/"+row+"/confirm",Map.of("greetingSnapshot","stale preview")).path("success").asBoolean()).isFalse();
        assertThat(count("SELECT COUNT(*) FROM delivery_attempt")).isZero();
        String greeting=greetings.resolveForJob("boss",row).finalGreeting();
        workbench.evaluate("args=>{document.querySelector('#confirm').onclick=async()=>{const response=await fetch('/api/boss/jobs/'+args.id+'/confirm',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({greetingSnapshot:args.greeting})});window.confirmedTask=await response.json();document.querySelector('#result').textContent=window.confirmedTask.success?'已确认':'失败';}}",Map.of("id",Math.toIntExact(row),"greeting",greeting));
        workbench.locator("#confirm").click();workbench.waitForFunction("window.confirmedTask?.success===true");
        JsonNode task=tree(workbench.evaluate("window.confirmedTask.task"));String key=task.path("requestKey").asText();assertThat(key).isNotBlank();
        var unauthorized=HttpRequest.newBuilder(URI.create(origin+"/api/delivery-attempts/"+key+"/runtime/claim"))
            .header("Origin",com.getjobs.application.config.CorsConfig.CHROME_EXTENSION_ORIGIN)
            .header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString("{}")).build();
        assertThat(HttpClient.newHttpClient().send(unauthorized,HttpResponse.BodyHandlers.ofString()).statusCode()).isEqualTo(401);
        assertThat(jdbc.queryForObject("SELECT runtime_phase FROM delivery_attempt",String.class)).isEqualTo("NOT_STARTED");
        var tabs=tree(extension.evaluate("async()=>await chrome.tabs.query({})"));int owner=0;for(var tab:tabs) if(tab.path("url").asText().equals(workbench.url())) owner=tab.path("id").asInt();assertThat(owner).isPositive();
        JsonNode claimed=tree(extension.evaluate("async args=>await chrome.runtime.sendMessage({type:'OFFLINE_PIPELINE_CLAIM',...args})",Map.of("task",JSON.convertValue(task,Map.class),"owner",owner)));
        assertThat(claimed.has("task")).withFailMessage(claimed.toString()).isTrue();JsonNode runtimeTask=claimed.path("task");assertThat(runtimeTask.path("runtime").path("claimVersion").asInt()).isEqualTo(1);
        String execute="const task="+runtimeTask+";const before=GetJobsBossPageEvidence.countRenderedGreetingMessages(document,task.greeting);const blocked=await BrowserApplicationRuntime.beforeEffect({task,begin:async body=>{const response=await chrome.runtime.sendMessage({source:'GET_JOBS_BOSS_CONTENT',type:'BOSS_LOCAL_API',operation:'runtime-begin',params:{requestKey:task.requestKey},pageTabId:"+owner+",body});return response.data||{};},observe:()=>GetJobsBossPageEvidence.observe({document,href:location.href,styleReader:getComputedStyle}),matches:()=>location.href===task.url,active:()=>true});if(blocked)return {blocked};const row=document.createElement('div');row.className='item-myself';const text=document.createElement('div');text.className='text-content';text.textContent=task.greeting;row.append(text);document.body.append(row);const after=GetJobsBossPageEvidence.countRenderedGreetingMessages(document,task.greeting);return GetJobsBossPageEvidence.evaluateEvidence({beforeCount:before,afterCount:after,state:GetJobsBossPageEvidence.observe({document,href:location.href,styleReader:getComputedStyle})});";
        JsonNode evidence=tree(probe(execute));assertThat(evidence.path("outcome").asText()).withFailMessage(evidence.toString()).isEqualTo("CONFIRMED");
        assertThat(tree(probe(execute)).has("blocked")).isTrue();assertThat(job.locator(".item-myself").count()).isEqualTo(1);
        // Platform effect is observed but callback is deliberately delayed: page reload must never re-apply.
        job.reload();await(()->Boolean.TRUE.equals(probe("return !!globalThis.GetJobsBossPageEvidence")));
        assertThat(tree(probe(execute)).has("blocked")).isTrue();assertThat(job.locator(".item-myself").count()).isZero();
        Map<String,Object> callback=Map.of("requestKey",key,"outcome","CONFIRMED","evidence",evidence.path("kind").asText(),"greetingOutcome","CONFIRMED","greetingEvidence","GREETING_RENDERED_EXACT");
        String report="return await chrome.runtime.sendMessage({source:'GET_JOBS_BOSS_CONTENT',type:'BOSS_LOCAL_API',operation:'delivery-result',params:{id:"+row+"},body:"+JSON.writeValueAsString(callback)+"});";
        assertThat(tree(probe(report)).path("data").path("accepted").asBoolean()).isTrue();
        assertThat(tree(probe(report)).path("data").path("idempotent").asBoolean()).isTrue();
        assertThat(jdbc.queryForObject("SELECT state FROM delivery_attempt",String.class)).isEqualTo("CONFIRMED");
        assertThat(jdbc.queryForObject("SELECT delivery_status FROM boss_data",String.class)).isEqualTo("已投递");
        assertThat(jdbc.queryForObject("SELECT stage FROM opportunity",String.class)).isEqualTo("APPLIED");
        assertThat(count("SELECT COUNT(*) FROM opportunity_event WHERE type='APPLICATION_CONFIRMED'")).isEqualTo(1);
        assertThat(count("SELECT COUNT(*) FROM runtime_event WHERE phase='EFFECT_POSSIBLE'")).isEqualTo(1);
        assertThat(tree(probe(collect)).path("success").asBoolean()).isTrue();
        assertThat(count("SELECT COUNT(*) FROM delivery_attempt")).isEqualTo(1);assertThat(count("SELECT COUNT(*) FROM job_ai_analysis")).isEqualTo(1);
        assertThat(aiCalls.get()).isEqualTo(1);verifyNoInteractions(cli);
        assertThat(jdbc.queryForList("PRAGMA foreign_key_check")).isEmpty();
    }
    Object probe(String body) {return extension.evaluate("async url=>{const tab=(await chrome.tabs.query({})).find(t=>t.url===url);const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:async()=>{"+body+"}});return result[0].result;}",JOB_URL);}
    JsonNode http(String path,Object value) throws Exception {var request=HttpRequest.newBuilder(URI.create(origin+path)).header("Content-Type","application/json").POST(HttpRequest.BodyPublishers.ofString(JSON.writeValueAsString(value))).build();return JSON.readTree(HttpClient.newHttpClient().send(request,HttpResponse.BodyHandlers.ofString()).body());}
    int count(String sql) {return jdbc.queryForObject(sql,Integer.class);}
    JsonNode tree(Object value) {return JSON.valueToTree(value);}
    void await(java.util.function.BooleanSupplier condition) {long end=System.nanoTime()+java.time.Duration.ofSeconds(25).toNanos();while(System.nanoTime()<end){if(condition.getAsBoolean())return;job.waitForTimeout(100);}throw new AssertionError("Isolated pipeline condition timed out");}
    static Path createRoot() {try{return Files.createTempDirectory("jobpilot-full-pipeline-");}catch(Exception e){throw new ExceptionInInitializerError(e);}}
}
