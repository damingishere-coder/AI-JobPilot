package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.boot.context.properties.bind.Bindable;
import org.springframework.boot.context.properties.bind.Binder;
import org.springframework.boot.context.properties.source.ConfigurationPropertySources;
import org.springframework.boot.env.YamlPropertySourceLoader;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;

import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;

import static org.assertj.core.api.Assertions.assertThat;

class SqliteRuntimeConcurrencyTest {
    @TempDir Path dir;

    @Test void productionPoolAllowsSnapshotReadsDuringHrWritesAndScanHeartbeatWaitsForAWriter() throws Exception {
        var sources=new YamlPropertySourceLoader().load("runtime",new ClassPathResource("application.yaml"));
        var config=new Binder(ConfigurationPropertySources.from(sources))
                .bind("spring.datasource.hikari",Bindable.of(HikariConfig.class)).get();
        config.setJdbcUrl("jdbc:sqlite:"+dir.resolve("shared.db"));
        try(var pool=new HikariDataSource(config)) {
            var db=new JdbcTemplate(pool);
            org.flywaydb.core.Flyway.configure().dataSource(pool).locations("classpath:db/migration").load().migrate();
            db.update("INSERT INTO profile(id,name,is_active) VALUES(1,'合成档案',1)");
            assertThat(db.queryForObject("PRAGMA journal_mode",String.class)).isEqualTo("wal");
            assertThat(db.queryForObject("PRAGMA busy_timeout",Integer.class)).isEqualTo(10000);
            var scan=new ScanRunService(db,new ObjectMapper(),new DataSourceTransactionManager(pool));
            scan.register("boss",1,"scan-concurrent");
            try(var reader=pool.getConnection()) {
                reader.setAutoCommit(false);
                try(var query=reader.createStatement();var result=query.executeQuery("SELECT name FROM profile WHERE id=1")) {
                    assertThat(result.next()).isTrue();
                    db.update("UPDATE profile SET name='合成档案已更新' WHERE id=1");
                    assertThat(result.getString(1)).isEqualTo("合成档案");
                }
                reader.rollback();
            }
            CompletableFuture<Map<String,Object>> heartbeat;
            try(var writer=pool.getConnection()) {
                writer.setAutoCommit(false);
                try(var statement=writer.createStatement()) {statement.executeUpdate("UPDATE profile SET name=name WHERE id=1");}
                heartbeat=CompletableFuture.supplyAsync(()->scan.sync("boss",1,"scan-concurrent",Map.of("epoch",1,"pageAlive",true)));
                // The competing transaction must wait for the writer, not fail
                // immediately when upgrading a stale deferred read snapshot.
                Thread.sleep(150);
                assertThat(heartbeat.isDone()).isFalse();
                writer.commit();
            }
            assertThat(heartbeat.get(3,TimeUnit.SECONDS).get("success")).isEqualTo(true);
            assertThat(scan.detail("boss",1,"scan-concurrent").get("pageConnected")).isEqualTo(true);
        }
    }

    @Test void failedFinalizationRollsBackTheProposalAndAllowsAnalysisRetry() throws Exception {
        var sources=new YamlPropertySourceLoader().load("runtime",new ClassPathResource("application.yaml"));
        var config=new Binder(ConfigurationPropertySources.from(sources))
                .bind("spring.datasource.hikari",Bindable.of(HikariConfig.class)).get();
        config.setJdbcUrl("jdbc:sqlite:"+dir.resolve("atomic.db"));
        try(var pool=new HikariDataSource(config)) {
            var db=new JdbcTemplate(pool);
            org.flywaydb.core.Flyway.configure().dataSource(pool).locations("classpath:db/migration").load().migrate();
            db.update("INSERT INTO profile(id,name,is_active) VALUES(1,'合成档案',1)");
            var json=new ObjectMapper();var crypto=new HrAssistantCryptoService(dir.resolve("atomic.key"));
            var hr=new HrAssistantStore(db,crypto,json);var policies=new HrAutopilotStore(db,json,crypto,hr);
            var target=new HrBackgroundStore(db,crypto,json,hr,policies);
            var factory=new org.springframework.aop.framework.ProxyFactory(target);
            var transactions=new org.springframework.transaction.interceptor.TransactionInterceptor();
            transactions.setTransactionManager(new DataSourceTransactionManager(pool));
            transactions.setTransactionAttributeSource(new org.springframework.transaction.annotation.AnnotationTransactionAttributeSource());
            factory.addAdvice(transactions);
            var queue=(HrBackgroundStore)factory.getProxy();
            var identity=new com.getjobs.application.hr.HrAssistantTypes.ChatSession("synthetic","","合成HR","合成公司","采购","","您好","今天");
            long conversation=hr.upsertConversation(1L,identity);
            var draft=new com.getjobs.application.hr.HrAssistantTypes.AiDraft(
                    com.getjobs.application.hr.HrAssistantTypes.Classification.REPLY,"您好","普通回复",java.util.List.of(),java.util.List.of(),1);
            org.assertj.core.api.Assertions.assertThatThrownBy(()->queue.commitProposal(1L,()->{
                hr.createProposal(1L,conversation,"synthetic-source",draft);
                throw new org.springframework.dao.DataAccessResourceFailureException("simulated outbox write failure");
            })).isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThat(db.queryForObject("SELECT COUNT(*) FROM hr_reply_proposal",Integer.class)).isZero();
            assertThat(queue.commitProposal(1L,()->hr.createProposal(1L,conversation,"synthetic-source",draft))).isPositive();
        }
    }
}
