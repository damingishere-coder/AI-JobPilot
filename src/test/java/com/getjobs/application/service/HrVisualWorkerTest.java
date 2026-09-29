package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrVisualTypes;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import java.io.BufferedReader;
import java.io.StringReader;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeoutException;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.function.Consumer;
import com.fasterxml.jackson.databind.JsonNode;
import static org.assertj.core.api.Assertions.*;

class HrVisualWorkerTest {
    @Test void progressFramesNeverRenewTheAbsoluteDeadline() {
        var worker=new HrVisualWorker(new ObjectMapper());var count=new AtomicInteger();
        var reader=new BufferedReader(new StringReader("")) {
            @Override public String readLine() {
                try {Thread.sleep(30);}catch(InterruptedException e){Thread.currentThread().interrupt();return null;}
                count.incrementAndGet();
                return "{\"protocol\":\""+HrVisualTypes.PROTOCOL+"\",\"requestId\":\"r\",\"phase\":\"progress\"}";
            }
        };
        try(var pool=Executors.newSingleThreadExecutor()) {
            assertThatThrownBy(()->ReflectionTestUtils.invokeMethod(worker,"readResult",pool,reader,"r",1,(Consumer<JsonNode>)e->{}))
                    .hasRootCauseInstanceOf(TimeoutException.class);
            assertThat(count.get()).isBetween(1,60);
        }
    }
}
