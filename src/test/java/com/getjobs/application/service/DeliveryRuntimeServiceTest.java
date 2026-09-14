package com.getjobs.application.service;

import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.concurrent.Executors;
import java.util.concurrent.Callable;
import java.util.List;
import static org.assertj.core.api.Assertions.assertThat;

class DeliveryRuntimeServiceTest {
    @TempDir Path temp;
    JdbcTemplate jdbc;
    DeliveryAttemptService attempts;
    DataSourceTransactionManager manager;
    DeliveryRuntimeService runtime;
    String key;
    String url = "https://www.zhipin.com/job_detail/fixture10.html";
    String greeting = "您好，我有相关产品运营和流程优化经验，希望进一步了解岗位要求。";
    @BeforeEach void setup() {
        var ds = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("runtime.db") + "?busy_timeout=5000");
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        jdbc = new JdbcTemplate(ds); manager = new DataSourceTransactionManager(ds);
        attempts = new DeliveryAttemptService(jdbc, manager);
        runtime = new DeliveryRuntimeService(jdbc, attempts, manager, true);
        jdbc.update("INSERT INTO profile(id,name,is_active) VALUES(1,'test',1)");
        jdbc.update("INSERT INTO boss_data(id,profile_id,encrypt_id,job_url,delivery_status) VALUES(10,1,'fixture10',?,?)", url, DeliveryStatus.WAITING_CONFIRM);
        key = attempts.requestBoss(10,1,"fixture10",false).requestKey();
        attempts.snapshotGreeting(key,greeting,"USER_EDITED");
    }
    DeliveryRuntimeService.Claim claim(String owner) {
        return new DeliveryRuntimeService.Claim("boss",1,10,url,greeting,"run",owner,"correlation");
    }
    DeliveryRuntimeService.Begin begin(String owner) {
        return new DeliveryRuntimeService.Begin(1,owner,1,"JOB_DETAIL","NONE");
    }
    @Test void onlyOneOwnerAndOnlyOnePermitAcrossRestarts() {
        assertThat(runtime.claim(key,claim("one"))).containsEntry("enabled",true);
        assertThat(runtime.claim(key,claim("one"))).containsEntry("success",false);
        assertThat(runtime.claim(key,claim("two"))).containsEntry("success",false);
        assertThat(runtime.begin(key,begin("two"))).containsEntry("success",false);
        assertThat(runtime.begin(key,begin("one"))).containsEntry("permitted",true);
        var restarted = new DeliveryRuntimeService(jdbc,attempts,manager,true);
        assertThat(restarted.begin(key,begin("one"))).containsEntry("success",false);
        assertThat(restarted.claim(key,claim("new-session"))).containsEntry("success",false);
        assertThat(runtime.timeline(key)).extracting(row -> row.get("phase")).containsExactly("CLAIMED","EFFECT_POSSIBLE");
    }
    @Test void concurrentPermitsNeverDuplicateEffect() throws Exception {
        runtime.claim(key,claim("one"));
        try (var pool = Executors.newFixedThreadPool(2)) {
            Callable<Boolean> issue = () -> Boolean.TRUE.equals(runtime.begin(key,begin("one")).get("permitted"));
            var results = pool.invokeAll(List.of(issue,issue));
            assertThat(results.stream().filter(result -> { try { return result.get(); } catch(Exception e) { throw new RuntimeException(e); } }).count()).isEqualTo(1);
        }
    }
    @Test void legacyRowsAndDisabledRolloutCannotResumeClaimedWork() {
        jdbc.update("UPDATE delivery_attempt SET runtime_phase='LEGACY' WHERE request_key=?",key);
        assertThat(runtime.claim(key,claim("one"))).containsEntry("success",false);
        jdbc.update("UPDATE delivery_attempt SET runtime_phase='NOT_STARTED' WHERE request_key=?",key);
        var disabled = new DeliveryRuntimeService(jdbc,attempts,manager,false);
        assertThat(disabled.claim(key,claim("one"))).containsEntry("enabled",false);
        assertThat(runtime.claim(key,claim("one"))).containsEntry("success",false);
        jdbc.update("UPDATE delivery_attempt SET runtime_phase='NOT_STARTED' WHERE request_key=?",key);
        runtime.claim(key,claim("one"));
        assertThat(disabled.claim(key,claim("one"))).containsEntry("success",false);
        assertThat(disabled.begin(key,begin("one"))).containsEntry("success",false);
        assertThat(runtime.begin(key,new DeliveryRuntimeService.Begin(1,"one",1,"JOB_DETAIL","LOGIN_REQUIRED"))).containsEntry("success",false);
    }
    @Test void resultAndAuditAreAtomicAndDuplicateCallbackAddsNoEvent() {
        runtime.claim(key,claim("one")); runtime.begin(key,begin("one"));
        assertThat(attempts.resolveBoss(1L,10,key,DeliveryAttemptService.State.FAILED,"PRE_ACTION_ERROR","late",null,null,
                DeliveryAttemptService.GreetingOutcome.NOT_SENT,"PRE_ACTION_ERROR").accepted()).isFalse();
        for(int i=0;i<2;i++) attempts.resolveBoss(1L,10,key,DeliveryAttemptService.State.UNKNOWN,"NO_CONFIRMATION","lost",null,null,DeliveryAttemptService.GreetingOutcome.UNKNOWN,"GREETING_UNCONFIRMED");
        assertThat(runtime.timeline(key)).extracting(row -> row.get("phase")).containsExactly("CLAIMED","EFFECT_POSSIBLE","UNKNOWN");
        assertThat(attempts.prepareRecovery(key,1)).containsEntry("success",true);
        assertThat(runtime.claim(key,claim("new"))).containsEntry("success",false);
        jdbc.update("UPDATE profile SET is_active=0 WHERE id=1");
        assertThat(runtime.timeline(key)).isEmpty();
    }
    @Test void changedProfileAndUnconfirmedTaskCannotObtainPermit() {
        assertThat(runtime.claim("missing",claim("one"))).containsEntry("success",false);
        runtime.claim(key,claim("one"));
        jdbc.update("UPDATE profile SET is_active=0 WHERE id=1");
        assertThat(runtime.begin(key,begin("one"))).containsEntry("success",false);
    }
    @Test void migrationPreservesHistoricalAttemptAndNeverInventsAnUnstartedPhase() {
        var ds = new DriverManagerDataSource("jdbc:sqlite:" + temp.resolve("v20.db"));
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").target("20").load().migrate();
        var old = new JdbcTemplate(ds);
        old.update("INSERT INTO delivery_attempt(request_key,platform,profile_id,job_key,job_row_id,state,evidence,requested_at,updated_at) " +
                "VALUES('old','boss',1,'old-job',1,'REQUESTED','USER_CONFIRMED',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)");
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        Flyway.configure().dataSource(ds).locations("classpath:db/migration").load().migrate();
        assertThat(old.queryForMap("SELECT state,evidence,runtime_phase,claim_version FROM delivery_attempt WHERE request_key='old'"))
                .containsEntry("state","REQUESTED").containsEntry("evidence","USER_CONFIRMED").containsEntry("runtime_phase","LEGACY").containsEntry("claim_version",0);
        assertThat(old.queryForObject("SELECT COUNT(*) FROM runtime_event",Integer.class)).isZero();
        assertThat(old.queryForObject("PRAGMA integrity_check",String.class)).isEqualTo("ok");
    }
    @Test void observationIsPrivateIdempotentAndCannotProveSuccess() {
        runtime.claim(key,claim("one"));
        var observation = new DeliveryRuntimeService.Observation(1,"one",1,"JOB_DETAIL","NONE",0,1);
        runtime.observe(key,observation); runtime.observe(key,observation);
        assertThat(runtime.timeline(key)).hasSize(2);
        assertThat(jdbc.queryForObject("SELECT state FROM delivery_attempt WHERE request_key=?",String.class,key)).isEqualTo("REQUESTED");
        assertThat(runtime.observe(key,new DeliveryRuntimeService.Observation(1,"one",1,"secret-chat","NONE",0,1))).containsEntry("success",false);
    }
    @Test void pauseIsDurableAndPreventsPendingEffects() {
        runtime.claim(key,claim("one"));
        assertThat(runtime.pause(key)).containsEntry("success",true);
        runtime.pause(key);
        assertThat(runtime.timeline(key)).hasSize(2);
        var restarted=new DeliveryRuntimeService(jdbc,attempts,manager,true);
        assertThat(restarted.begin(key,begin("one"))).containsEntry("success",false);
        assertThat(restarted.claim(key,claim("new"))).containsEntry("success",false);
        jdbc.update("INSERT INTO boss_data(id,profile_id,encrypt_id,job_url,delivery_status) VALUES(11,1,'fixture11',?,?)",url,DeliveryStatus.WAITING_CONFIRM);
        String next=attempts.requestBoss(11,1,"fixture11",false).requestKey();
        attempts.snapshotGreeting(next,greeting,"USER_EDITED");
        assertThat(restarted.claim(next,new DeliveryRuntimeService.Claim("boss",1,11,url,greeting,"run","new","next-correlation"))).containsEntry("success",false);
    }
}
