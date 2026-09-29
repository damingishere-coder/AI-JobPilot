package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrVisualTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.Function;
import java.util.function.Consumer;

/** Private child-process protocol. No socket, browser extension or arbitrary executable in requests. */
@Service
@RequiredArgsConstructor
public class HrVisualWorker {
    private final ObjectMapper json;
    @Value("${app.hr-visual.python:./hr-visual/.venv/Scripts/python.exe}") private String python;
    @Value("${app.hr-visual.script:./hr-visual/worker.py}") private String script;
    @Value("${app.paths.data-dir:./data}") private String dataDir;
    private volatile BufferedWriter activeWriter;
    public Map<String,Object> availability() {
        return Map.of("installed",Files.isRegularFile(Path.of(python)) && Files.isRegularFile(Path.of(script)),
                "protocol",HrVisualTypes.PROTOCOL,"transport","WINDOWS_VISUAL");
    }
    public void cancel() {
        var writer=activeWriter;
        if(writer!=null) try{write(writer,Map.of("operation","cancel"));}catch(IOException ignored){ }
    }
    public void purgeEvidence(List<String> ids) {
        Path root=Path.of(dataDir).toAbsolutePath().normalize().resolve("hr-visual-evidence");
        for(String id:ids) {
            if(!id.matches("[a-f0-9-]{36}")) continue;
            for(String part:List.of("before","after")) {
                Path file=root.resolve(id+"-"+part+".png.dpapi").normalize();
                if(!file.getParent().equals(root))throw new IllegalStateException("证据路径越界");
                try {Files.deleteIfExists(file);}catch(IOException e){throw new IllegalStateException("过期视觉证据清理失败",e);}
            }
        }
    }
    public JsonNode exchange(Map<String,Object> request, Function<JsonNode,Boolean> authorize) {
        return exchange(request,authorize,event->{});
    }
    public JsonNode exchange(Map<String,Object> request, Function<JsonNode,Boolean> authorize, Consumer<JsonNode> progress) {
        if(!Boolean.TRUE.equals(availability().get("installed"))) throw new IllegalStateException("视觉环境未安装，请运行 hr-visual/setup.ps1");
        Process process=null;
        var readerPool=Executors.newSingleThreadExecutor(Thread.ofVirtual().factory());
        try {
            process=new ProcessBuilder(Path.of(python).toAbsolutePath().toString(),"-u",Path.of(script).toAbsolutePath().toString())
                    .redirectError(ProcessBuilder.Redirect.DISCARD).start();
            Process child=process;
            try(var reader=new BufferedReader(new InputStreamReader(process.getInputStream(),StandardCharsets.UTF_8));
                var writer=new BufferedWriter(new OutputStreamWriter(process.getOutputStream(),StandardCharsets.UTF_8))) {
                try {
                activeWriter=writer;
                String requestId=UUID.randomUUID().toString();
                var payload=new LinkedHashMap<>(request);
                payload.put("protocol",HrVisualTypes.PROTOCOL);payload.put("requestId",requestId);
                write(writer,payload);
                JsonNode prepared=readResult(readerPool,reader,requestId,60,progress);
                if(!prepared.path("phase").asText().equals("prepared")) return prepared;
                boolean approved=authorize!=null && authorize.apply(prepared);
                write(writer,Map.of("operation",approved?"commit":"cancel","nonce",prepared.path("nonce").asText(),"requestId",requestId));
                return readResult(readerPool,reader,requestId,30,progress);
                } finally {
                    // Kill before BufferedReader.close: a timed-out reader owns its monitor.
                    if(child.isAlive()) child.destroyForcibly();
                }
            }
        } catch(Exception e) {
            if(e instanceof RuntimeException runtime) throw runtime;
            throw new IllegalStateException("视觉执行器中断或超时，提交阶段的结果必须人工核验",e);
        } finally {
            activeWriter=null;
            if(process!=null && process.isAlive()) process.destroyForcibly();
            readerPool.shutdownNow();
        }
    }
    private JsonNode readResult(ExecutorService pool,BufferedReader reader,String requestId,int seconds,Consumer<JsonNode> progress)throws Exception {
        long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(seconds);
        while(true) {
            long remaining=deadline-System.nanoTime();
            if(remaining<=0)throw new TimeoutException("视觉操作总等待超时");
            JsonNode event=read(pool,reader,remaining);validate(event,requestId);
            if(!event.path("phase").asText().equals("progress"))return event;
            progress.accept(event);
        }
    }
    private synchronized void write(BufferedWriter w,Object data)throws IOException {w.write(json.writeValueAsString(data));w.newLine();w.flush();}
    private JsonNode read(ExecutorService pool,BufferedReader r,long nanos)throws Exception {
        String line=pool.submit(r::readLine).get(nanos,TimeUnit.NANOSECONDS);
        if(line==null || line.length()>4_000_000) throw new IllegalStateException("视觉执行器响应缺失或过大");
        return json.readTree(line);
    }
    private void validate(JsonNode n,String requestId) {
        if(!HrVisualTypes.PROTOCOL.equals(n.path("protocol").asText()) || !requestId.equals(n.path("requestId").asText()))
            throw new IllegalStateException("视觉执行器协议或请求身份不匹配");
    }
}
