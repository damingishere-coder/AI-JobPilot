package com.getjobs.application.service;

import com.getjobs.application.dto.ChromeJobBatchRequest;
import com.getjobs.application.dto.ChromeJobDto;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import java.nio.file.Path;
import java.util.*;
import java.util.concurrent.atomic.AtomicInteger;
import static org.junit.jupiter.api.Assertions.*;

class FreshScanReceiptServiceTest {
    @TempDir Path dir;
    JdbcTemplate jdbc;
    FreshScanReceiptService service;
    @BeforeEach void setup() throws Exception {
        jdbc = new JdbcTemplate(new DriverManagerDataSource("jdbc:sqlite:" + dir.resolve("test.db")));
        jdbc.execute("CREATE TABLE boss_data(profile_id INTEGER, encrypt_id TEXT)");
        jdbc.execute("CREATE TABLE zhilian_data(profile_id INTEGER, job_id TEXT)");
        jdbc.execute("CREATE TABLE job_analysis_task(profile_id INTEGER,platform TEXT,scan_run_id TEXT,job_key TEXT)");
        try (var in = getClass().getResourceAsStream("/db/migration/V20__fresh_scan_receipts.sql")) {
            jdbc.execute(new String(Objects.requireNonNull(in).readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
        }
        service = new FreshScanReceiptService(jdbc);
    }
    ChromeJobBatchRequest request(String run, String keyword) {
        var job = new ChromeJobDto(); job.setId("abc"); job.setUrl("https://www.zhipin.com/job_detail/abc.html");
        job.setDetailVerified(true); job.setDescription("岗位职责和任职要求".repeat(8));
        var r = new ChromeJobBatchRequest(); r.setProfileId(4L); r.setRunId(run); r.setKeyword(keyword); r.setJobs(List.of(job)); r.setFreshOnly(true); return r;
    }
    @SuppressWarnings("unchecked") Map<String,Object> receipt(ResponseEntity<Map<String,Object>> r) {
        return ((List<Map<String,Object>>) r.getBody().get("items")).getFirst();
    }
    @Test void lostResponseReplayAndOtherKeywordsNeverEnqueueTwice() {
        var calls = new AtomicInteger();
        java.util.function.Function<ChromeJobBatchRequest,ResponseEntity<Map<String,Object>>> receiver = r -> {
            calls.incrementAndGet(); jdbc.update("INSERT INTO boss_data VALUES(4,'abc')");
            jdbc.update("INSERT INTO job_analysis_task VALUES(4,'boss',?,'abc')", r.getRunId());
            return ResponseEntity.ok(Map.of("success", true));
        };
        assertEquals(true, receipt(service.submit("boss", request("run1","first"), receiver)).get("freshAccepted"));
        assertEquals(true, receipt(service.submit("boss", request("run1","first"), receiver)).get("freshAccepted"));
        assertEquals(false, receipt(service.submit("boss", request("run1","second"), receiver)).get("freshAccepted"));
        assertEquals(false, receipt(service.submit("boss", request("run2","first"), receiver)).get("freshAccepted"));
        assertEquals(1, calls.get());
    }
    @Test void allHistoricalRowsAreExcludedEvenWithoutAnAnalysisTask() {
        jdbc.update("INSERT INTO zhilian_data VALUES(4,'abc')");
        var result = service.submit("zhilian", request("run","kw"), r -> { fail("Historical row must not be submitted"); return null; });
        assertEquals(false, receipt(result).get("freshAccepted"));
    }
    @Test void queueRejectionCanResumeAfterRowWasSaved() {
        var r = request("run","kw");
        var first = service.submit("boss", r, item -> { jdbc.update("INSERT INTO boss_data VALUES(4,'abc')"); return ResponseEntity.status(429).body(Map.of("success",false,"items",List.of(Map.of("status","REJECTED","retryable",true,"errorCode","QUEUE_FULL")))); });
        assertEquals(true, receipt(first).get("retryable")); assertEquals(false, receipt(first).get("freshAccepted"));
        var next = service.submit("boss", r, item -> { jdbc.update("INSERT INTO job_analysis_task VALUES(4,'boss','run','abc')"); return ResponseEntity.ok(Map.of("success",true)); });
        assertEquals(true, receipt(next).get("freshAccepted"));
    }
    @Test void crashAfterEnqueueBeforeReceiptWriteRecoversFromDurableTask() {
        jdbc.update("INSERT INTO fresh_scan_receipt(profile_id,platform,scan_run_id,job_key,keyword,eligible) VALUES(4,'boss','run','abc','kw',1)");
        jdbc.update("INSERT INTO job_analysis_task VALUES(4,'boss','run','abc')");
        assertEquals(true, receipt(service.submit("boss", request("run","kw"), r -> { fail("Do not call AI again"); return null; })).get("freshAccepted"));
    }
    @Test void listSummaryAndFailedDetailNeverCountOrCallReceiver() {
        var r = request("run","kw"); r.getJobs().getFirst().setDetailVerified(false);
        assertEquals("INSUFFICIENT", receipt(service.submit("boss",r, one -> { fail("Unverified detail must not enqueue"); return null; })).get("status"));
        r.getJobs().getFirst().setDetailVerified(true); r.getJobs().getFirst().setDetailNavigationFailed(true);
        assertEquals(false, receipt(service.submit("boss",r, one -> { fail("Failed detail must not enqueue"); return null; })).get("freshAccepted"));
        assertEquals("abc", FreshScanReceiptService.key(new ChromeJobDto() {{setUrl("https://www.zhaopin.com/jobdetail/abc.htm?ref=search");}}));
    }
    @Test void permanentRejectionDoesNotCauseInfiniteQueueWait() {
        var result = service.submit("boss",request("run","kw"), one -> ResponseEntity.status(429).body(Map.of(
                "rejected", List.of(Map.of("status","REJECTED","retryable",false,"errorCode","PERSISTENCE_ERROR")))));
        assertEquals("FAILED", receipt(result).get("status"));
        assertEquals(false, receipt(result).get("retryable"));
    }
    @Test void whitespaceInHistoricalIdIsStillADuplicate() {
        jdbc.update("INSERT INTO boss_data VALUES(4,' abc ')");
        assertEquals(false,receipt(service.submit("boss",request("run","kw"), one -> {fail("Must dedupe");return null;})).get("freshAccepted"));
    }
}
