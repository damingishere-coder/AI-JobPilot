package com.getjobs.application;

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
import java.nio.file.*;
import java.util.*;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

/** Browser control/outbox -> real HTTP controller -> SQLite, with all non-test network denied. */
@Tag("browser")
@SpringBootTest(webEnvironment=SpringBootTest.WebEnvironment.RANDOM_PORT,properties={
    "app.auto-open-browser=false","app.browser.initialize-on-startup=false","app.static-server.enabled=false"
})
@DirtiesContext(classMode=DirtiesContext.ClassMode.AFTER_CLASS)
class ScanRunBrowserRegressionTest {
    static final Path ROOT=root();
    @DynamicPropertySource static void properties(DynamicPropertyRegistry r) {
        r.add("spring.datasource.url",()->"jdbc:sqlite:"+ROOT.resolve("scan.db"));
        r.add("app.hr-assistant.key-path",()->ROOT.resolve("fixture.key").toString());
        for(String folder:List.of("data","output","cache","log")) r.add("app.paths."+folder+"-dir",()->ROOT.resolve(folder).toString());
        r.add("logging.file.name",()->ROOT.resolve("log/test.log").toString());
    }
    @LocalServerPort int port;
    @Autowired JdbcTemplate jdbc;
    @MockitoBean ZhilianOptionInitializer options;
    @MockitoBean AiService ai;
    @MockitoBean CodexCliService cli;
    @MockitoBean com.getjobs.application.config.StaticResourceConfiguration staticResources;
    @Test void bothPlatformsPersistCountsAndConfirmControlsAcrossWorkerRestart() throws Exception {
        assertThat(port).isNotEqualTo(6866);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'Offline scan',1)");
        jdbc.update("INSERT INTO resume_profile(profile_id,resume_text,parse_status) VALUES(1,?,'SUCCESS')","Java 和 Spring Boot 后端开发、系统设计经验。北京，本科，3-5年，15-25K。");
        jdbc.update("INSERT INTO boss_config(profile_id,native_greeting_disabled_confirmed,say_hi) VALUES(1,1,?)","您好，虚构岗位测试。");
        when(ai.sendStructuredRequest(anyString(),anyString(),anyString())).thenAnswer(invocation->{
            var results=new ArrayList<Map<String,Object>>();
            for(Long id:jdbc.queryForList("SELECT id FROM job_analysis_task WHERE status='LEASED'",Long.class)) {
                var dimensions=new ArrayList<Map<String,Object>>();
                for(String key:List.of("CORE_SKILLS","RELEVANT_EXPERIENCE","ACHIEVEMENTS_COMPLEXITY","INDUSTRY_TRANSFER","EDUCATION_TENURE","LOCATION_SALARY"))
                    dimensions.add(Map.of("key",key,"status","MATCH","jobEvidence",List.of("Java"),"resumeEvidence",List.of("Java"),"note","虚构资料双方原文证据"));
                results.add(Map.of("taskId",id,"summary","虚构岗位匹配","matches",List.of("双方提到 Java"),"gaps",List.of(),"unknowns",List.of(),"dimensions",dimensions,"hardConflicts",List.of(),"greeting","您好，虚构岗位测试。"));
            }
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(Map.of("results",results));
        });
        try(Playwright pw=Playwright.create();Browser browser=pw.chromium().launch(new BrowserType.LaunchOptions().setHeadless(true))) {
            var context=browser.newContext();String origin="http://127.0.0.1:"+port;
            context.route("**/*",route->{
                String url=route.request().url();
                if(url.equals("http://localhost:6866/offline-scan")) route.fulfill(new Route.FulfillOptions().setContentType("text/html").setBody("<title>Offline scan</title><article data-job='synthetic'>Synthetic role</article>"));
                else if(url.startsWith(origin+"/"))route.resume();else route.abort();
            });
            Page page=context.newPage();page.navigate("http://localhost:6866/offline-scan");
            page.addScriptTag(new Page.AddScriptTagOptions().setContent(Files.readString(Path.of("chrome-extension/scan-observer.js"))));
            page.addScriptTag(new Page.AddScriptTagOptions().setContent(Files.readString(Path.of("chrome-extension/scan-control.js"))));
            page.evaluate("""
                async origin=>{
                  const token=(await (await fetch(origin+'/api/local-auth/action-token')).json()).data.token;
                  window.api=async(path,body)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Local-Action-Token':token},body:body?JSON.stringify(body):undefined});if(!response.ok)throw new Error('HTTP '+response.status+' '+path+' '+await response.text());return response.json()};
                  window.storage={get:async key=>({[key]:JSON.parse(localStorage.getItem(key)||'null')}),set:async values=>{for(const [key,value]of Object.entries(values))localStorage.setItem(key,JSON.stringify(value))}};
                  window.newObserver=()=>GetJobsScanObserver.create({storage,version:'1.8.16',request:async(path,options)=>({success:true,data:await api(path,options.body)})});
                  window.observer=newObserver();
                }
                """,origin);
            for(String platform:List.of("boss","zhilian")) {
                page.evaluate("""
                    async platform=>{
                      window.task={platform,profileId:1,runId:platform+'-offline',tabId:2,ownerToken:'fixture',scanOwnerToken:'fixture',scanProtocol:1,updatedAt:Date.now(),config:{keywords:['synthetic']}};
                      window.base='/api/scan-runs/'+task.runId+'?platform='+platform+'&profileId=1';
                      window.endpoint=suffix=>'/api/scan-runs/'+task.runId+suffix+'?platform='+platform+'&profileId=1';
                      await api('/api/scan-runs?platform='+platform+'&profileId=1',{runId:task.runId});await observer.attach(task);
                      window.saved=null;window.state={stage:'collecting'};
                      window.chrome={runtime:{sendMessage:async message=>observer.sync({...message,tabId:2})}};
                      window.control=GetJobsScanControl.create({platform,version:'1.8.16',instanceId:Date.now()+'-fixture',current:()=>true,readTask:()=>saved,saveTask:async t=>{saved={...t,updatedAt:Date.now()}},status:s=>state={...state,...s},readStatus:()=>state,setStopped:()=>{},resume:()=>{}});
                      await control.enter(task);
                      await observer.event(task,{stage:'collecting',keyword:'synthetic',totalRead:document.querySelectorAll('[data-job]').length,message:'DO_NOT_STORE_SECRET'});
                      await observer.sync(task);
                      await api(endpoint('/commands'),{kind:'PAUSE',id:platform+'-pause'});
                      await new Promise(r=>setTimeout(r,2100));window.pending=control.checkpoint();
                    }
                    """,platform);
                page.evaluate("async()=>{for(let i=0;i<50;i++){if((await api(base)).state==='PAUSED')return;await new Promise(r=>setTimeout(r,100))}throw new Error('Pause ACK missing')}");
                assertThat(jdbc.queryForObject("SELECT state FROM scan_run WHERE platform=?",String.class,platform)).isEqualTo("PAUSED");
                page.evaluate("""
                    async()=>{
                      window.observer=newObserver();
                      await api(endpoint('/commands'),{kind:'RESUME',id:task.platform+'-resume'});
                      await pending;
                    }
                    """);
                assertThat(jdbc.queryForObject("SELECT state FROM scan_run WHERE platform=?",String.class,platform)).isEqualTo("RUNNING");
                page.evaluate("""
                    async()=>{
                      window.batch={profileId:1,runId:task.runId,scanEpoch:control.epochFor(task.runId),keyword:'synthetic',freshOnly:true,jobs:[{id:task.platform+'-job',title:'Java工程师',company:'虚构公司',url:task.platform==='boss'?'https://www.zhipin.com/job_detail/offline.html':'https://jobs.zhaopin.com/offline.html',description:'Java 和 Spring Boot 后端开发、系统设计。任职要求：Java 项目交付经验，负责服务端开发和系统维护。',detailVerified:true}]};
                      const receipt=await api('/api/'+task.platform+'/chrome/jobs',batch);
                      if(receipt.freshAccepted!==1)throw new Error('Unexpected receipt '+JSON.stringify(receipt));
                    }
                    """);
                assertThat(((Number)page.evaluate("async()=>(await api(base)).accepted")).intValue()).isEqualTo(1);
                page.evaluate("async()=>{await api(endpoint('/commands'),{kind:'STOP',id:task.platform+'-stop'});await new Promise(r=>setTimeout(r,2100));await control.checkpoint()}");
                assertThat(jdbc.queryForObject("SELECT status FROM scan_command WHERE id=?",String.class,platform+"-stop")).isEqualTo("PENDING");
                assertThat(page.evaluate("async()=>{try{await api('/api/'+task.platform+'/chrome/jobs',batch);return false}catch(e){return String(e).includes('409')}}")).isEqualTo(true);
                page.evaluate("async()=>await control.leave()");
                assertThat(jdbc.queryForObject("SELECT state FROM scan_run WHERE platform=?",String.class,platform)).isEqualTo("STOPPED");
            }
            assertThat(jdbc.queryForList("SELECT payload FROM scan_event").toString()).doesNotContain("DO_NOT_STORE_SECRET");
            assertThat(jdbc.queryForList("PRAGMA foreign_key_check")).isEmpty();
            for(int i=0;i<100 && jdbc.queryForObject("SELECT COUNT(*) FROM job_analysis_task WHERE status='SUCCEEDED'",Integer.class)<2;i++)page.waitForTimeout(200);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM job_analysis_task WHERE status='SUCCEEDED'",Integer.class)).isEqualTo(2);
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM delivery_attempt",Integer.class)).isZero();
            verify(ai,atLeastOnce()).sendStructuredRequest(anyString(),anyString(),anyString());
            verifyNoInteractions(cli);
        }
    }
    static Path root(){try{return Files.createTempDirectory("jobpilot-scan-regression-");}catch(Exception e){throw new ExceptionInInitializerError(e);}}
}
