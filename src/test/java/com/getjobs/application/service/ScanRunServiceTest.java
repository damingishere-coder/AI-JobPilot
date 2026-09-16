package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.*;
import org.springframework.web.server.ResponseStatusException;
import java.nio.file.Path;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;

class ScanRunServiceTest {
    @TempDir Path dir;
    JdbcTemplate db;DriverManagerDataSource source;ScanRunService scans;
    @BeforeEach void setup() throws Exception {
        source=new DriverManagerDataSource("jdbc:sqlite:"+dir.resolve("scan.db"));db=new JdbcTemplate(source);
        for(String file:List.of("V20__fresh_scan_receipts.sql","V28__scan_observability.sql")) {
            String sql=new String(Objects.requireNonNull(getClass().getResourceAsStream("/db/migration/"+file)).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            for(String statement:sql.split(";")) if(!statement.isBlank())db.execute(statement);
        }
        db.execute("CREATE TABLE job_analysis_task(platform TEXT,profile_id INTEGER,scan_run_id TEXT,status TEXT)");
        restart();scans.register("boss",4,"r1");
    }
    void restart(){scans=new ScanRunService(db,new ObjectMapper(),new DataSourceTransactionManager(source));}
    Map<String,Object> event(String id,int epoch,int seq,String state){return new HashMap<>(Map.of("eventId",id,"epoch",epoch,"seq",seq,"state",state,"kind","progress","stage","detail"));}
    Map<String,Object> sync(int epoch,List<Map<String,Object>> events,Map<String,Object> ack){return scans.sync("boss",4,"r1",Map.of("epoch",epoch,"pageAlive",true,"extensionVersion","1.8.16","contentVersion","1.8.16","events",events,"ack",ack));}
    Map<String,Object> detail(){return scans.detail("boss",4,"r1");}
    @Test void replayOutOfOrderAndRawSecretsDoNotCorruptCountsOrLogs(){
        var newer=event("e2",1,2,"RUNNING");newer.put("message","Cookie: secret; resume personal details");newer.put("url","https://example.com/?token=secret");newer.put("counters",Map.of("read",30,"accepted",999));
        sync(1,List.of(newer,event("e1",1,1,"FAILED")),Map.of());sync(1,List.of(newer),Map.of());
        assertEquals("RUNNING",detail().get("state"));assertEquals(2,scans.events("boss",4,"r1",0).size());
        assertFalse(scans.events("boss",4,"r1",0).toString().contains("secret"));assertEquals(0,detail().get("accepted"));
        db.update("INSERT INTO fresh_scan_receipt VALUES(4,'boss','r1','job','kw',1,1,CURRENT_TIMESTAMP)");
        assertEquals(1,detail().get("accepted"));assertEquals("1.8.16",detail().get("content_version"));
    }
    @Test void stopIsDurableAndNeedsPageAckEvenAfterLateComplete(){
        sync(1,List.of(event("start",1,1,"RUNNING")),Map.of());
        scans.command("boss",4,"r1","STOP","stop1");restart();
        assertFalse(scans.accepts("boss",4,"r1"));assertEquals("RUNNING",detail().get("state"));
        sync(1,List.of(event("late",1,2,"COMPLETE")),Map.of());assertEquals("RUNNING",detail().get("state"));
        scans.sync("boss",4,"r1",Map.of("epoch",1,"pageAlive",false,"ack",Map.of("id","stop1","ok",true)));assertEquals("STOPPED",detail().get("state"));
        scans.command("boss",4,"r1","STOP","stop2");assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM scan_command",Integer.class));
    }
    @Test void resumeHasNewEpochAndStaleAckCannotUnlockSubmission(){
        sync(1,List.of(event("start",1,1,"RUNNING")),Map.of());scans.command("boss",4,"r1","PAUSE","p1");
        sync(1,List.of(),Map.of("id","p1","ok",true));assertEquals("PAUSED",detail().get("state"));
        scans.command("boss",4,"r1","RESUME","r2");assertFalse(scans.accepts("boss",4,"r1"));
        sync(1,List.of(event("old",1,90,"COMPLETE")),Map.of("id","r2","ok",true));assertFalse(scans.accepts("boss",4,"r1"));
        sync(2,List.of(),Map.of("id","r2","ok",true));assertTrue(scans.accepts("boss",4,"r1"));
        assertEquals("RUNNING",detail().get("state"));
        assertFalse(scans.accepts("boss",4,"r1",1L));assertFalse(scans.accepts("boss",4,"r1",null));assertTrue(scans.accepts("boss",4,"r1",2L));
    }
    @Test void backgroundHeartbeatDoesNotPretendPageIsAlive(){
        scans.sync("boss",4,"r1",Map.of("epoch",1));
        assertEquals(true,detail().get("backgroundConnected"));assertEquals(false,detail().get("pageConnected"));
        assertThrows(ResponseStatusException.class,()->scans.command("boss",4,"r1","RESUME","r"));
    }
    @Test void platformAndProfileAreIsolatedAndDuplicateCommandsAreIdempotent(){
        scans.register("zhilian",4,"r1");
        scans.command("boss",4,"r1","PAUSE","p");scans.command("boss",4,"r1","PAUSE","p-again");
        assertEquals(1,db.queryForObject("SELECT COUNT(*) FROM scan_command",Integer.class));
        assertTrue(scans.accepts("zhilian",4,"r1"));assertTrue(scans.accepts("boss",5,"r1"));
        assertThrows(ResponseStatusException.class,()->scans.command("zhilian",4,"r1","STOP","p"));
        assertThrows(ResponseStatusException.class,()->scans.register("boss",5,"r2"));
    }
    @Test void offlineStopFencesOldRunWithoutBlockingANewRunForever(){
        scans.command("boss",4,"r1","STOP","stop-offline");
        scans.register("boss",4,"r2");
        assertFalse(scans.accepts("boss",4,"r1",1L));
        assertTrue(scans.accepts("boss",4,"r2",1L));
        scans.sync("boss",4,"r1",Map.of("epoch",1,"ack",Map.of("id","stop-offline","ok",true)));
        assertEquals("STARTING",scans.detail("boss",4,"r2").get("state"));
    }
    @Test void historyIsNotInventedAndFailedCheckpointIsVisible(){
        db.update("INSERT INTO fresh_scan_receipt VALUES(4,'boss','old','job','kw',1,1,CURRENT_TIMESTAMP)");
        assertTrue(scans.list("boss",4).stream().anyMatch(r->Boolean.FALSE.equals(r.get("historyComplete"))));
        scans.command("boss",4,"r1","PAUSE","p");sync(1,List.of(),Map.of("id","p","ok",false,"errorCode","CHECKPOINT_SAVE_FAILED"));
        assertEquals("BLOCKED",detail().get("state"));assertTrue(detail().get("commands").toString().contains("CHECKPOINT_SAVE_FAILED"));
    }
}
