package com.getjobs.application.service;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import java.util.*;

/** Durable scan observations; collection receipts, never browser counters, own accepted totals. */
@Service
public class ScanRunService {
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final TransactionTemplate tx;
    private static final Set<String> TERMINAL = Set.of("COMPLETE", "PARTIAL", "FAILED", "STOPPED");
    public ScanRunService(JdbcTemplate jdbc, ObjectMapper json, org.springframework.transaction.PlatformTransactionManager manager) {
        this.jdbc = jdbc; this.json = json; this.tx = new TransactionTemplate(manager);
    }
    private Object[] key(String p,long profile,String run) { return new Object[]{p,profile,run}; }
    public synchronized Map<String,Object> register(String p,long profile,String run) {
        validate(p,profile,run);
        if(!managed(p,profile,run) && Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM scan_run WHERE platform=? AND desired<>'STOPPED' AND state NOT IN ('COMPLETE','PARTIAL','FAILED','STOPPED'))",Boolean.class,p))) fail("PLATFORM_SCAN_ALREADY_ACTIVE");
        long now=System.currentTimeMillis();
        jdbc.update("INSERT OR IGNORE INTO scan_run(platform,profile_id,run_id,created_at,updated_at) VALUES(?,?,?,?,?)",p,profile,run,now,now);
        return detail(p,profile,run);
    }
    public void validate(String p,long profile,String run) {
        if(p==null||!Set.of("boss","zhilian").contains(p)||profile<=0||run==null||!run.matches("[A-Za-z0-9_-]{1,120}")) fail("INVALID_SCAN_KEY");
    }
    private Map<String,Object> row(String p,long profile,String run) {
        validate(p,profile,run);
        var rows=jdbc.queryForList("SELECT * FROM scan_run WHERE platform=? AND profile_id=? AND run_id=?",key(p,profile,run));
        if(rows.isEmpty()) throw new ResponseStatusException(HttpStatus.NOT_FOUND,"SCAN_NOT_FOUND");
        return rows.getFirst();
    }
    public boolean managed(String p,long profile,String run) {
        return run!=null && Boolean.TRUE.equals(jdbc.queryForObject("SELECT EXISTS(SELECT 1 FROM scan_run WHERE platform=? AND profile_id=? AND run_id=?)",Boolean.class,p,profile,run));
    }
    public boolean accepts(String p,long profile,String run) {
        if(!managed(p,profile,run)) return true;
        var r=row(p,profile,run);
        return "RUNNING".equals(r.get("desired")) && !TERMINAL.contains(r.get("state"));
    }
    public boolean accepts(String p,long profile,String run,Long epoch) {
        if(!managed(p,profile,run)) return true;
        return epoch!=null && epoch==n(row(p,profile,run).get("epoch")) && accepts(p,profile,run);
    }
    public Map<String,Object> detail(String p,long profile,String run) {
        var r=new LinkedHashMap<>(row(p,profile,run)); long now=System.currentTimeMillis();
        r.put("backgroundConnected",now-n(r.get("background_seen_at"))<90000);
        r.put("pageConnected",now-n(r.get("page_seen_at"))<90000);
        r.put("historyComplete",true);
        r.put("keywordReceipts",jdbc.queryForList("SELECT keyword,COUNT(*) AS accepted FROM fresh_scan_receipt WHERE platform=? AND profile_id=? AND scan_run_id=? AND accepted=1 GROUP BY keyword",key(p,profile,run))); r.put("counters",parse(r.get("counters")));
        r.put("accepted",jdbc.queryForObject("SELECT COUNT(*) FROM fresh_scan_receipt WHERE platform=? AND profile_id=? AND scan_run_id=? AND accepted=1",Integer.class,key(p,profile,run)));
        r.put("analysis",jdbc.queryForList("SELECT status,COUNT(*) AS count FROM job_analysis_task WHERE platform=? AND profile_id=? AND scan_run_id=? GROUP BY status",key(p,profile,run)));
        r.put("errorMessage", switch(Objects.toString(r.get("error_code"),"")) {
            case "BACKEND_UNAVAILABLE" -> "后端连接中断，已保留断点";
            case "FILTER_NOT_APPLIED" -> "官网筛选未生效";
            case "SCAN_TAB_CLOSED" -> "扫描页面已关闭";
            case "COLLECTION_TIMEOUT" -> "采集达到时间上限";
            case "LOG_QUEUE_FULL" -> "日志缓冲已满，扫描已暂停";
            case "SETUP_NOT_READY" -> "启动前检查未通过，请补齐设置后重新扫描";
            case "START_FAILED" -> "启动结果未确认，请检查扩展连接和启动记录";
            case "" -> "";
            default -> "采集异常，详见错误代码、阶段及时间线";
        });
        r.put("commands",jdbc.queryForList("SELECT id,kind,epoch,status,error_code,created_at,updated_at FROM scan_command WHERE platform=? AND profile_id=? AND run_id=? ORDER BY created_at DESC LIMIT 20",key(p,profile,run)));
        return r;
    }
    public List<Map<String,Object>> list(String p,long profile) {
        validate(p,profile,"list");
        var result=new ArrayList<Map<String,Object>>();
        for(var r:jdbc.queryForList("SELECT run_id FROM scan_run WHERE platform=? AND profile_id=? ORDER BY created_at DESC LIMIT 50",p,profile)) result.add(detail(p,profile,r.get("run_id").toString()));
        for(var r:jdbc.queryForList("SELECT scan_run_id AS run_id,COUNT(*) AS accepted,MAX(updated_at) AS updated_at FROM fresh_scan_receipt f WHERE platform=? AND profile_id=? AND accepted=1 AND NOT EXISTS (SELECT 1 FROM scan_run s WHERE s.platform=f.platform AND s.profile_id=f.profile_id AND s.run_id=f.scan_run_id) GROUP BY scan_run_id ORDER BY MAX(updated_at) DESC LIMIT 20",p,profile)) {
            r.put("historyComplete",false); r.put("platform",p); r.put("profile_id",profile); r.put("state","LEGACY"); result.add(r);
        }
        return result;
    }
    public List<Map<String,Object>> events(String p,long profile,String run,long after) {
        row(p,profile,run);
        var rows=jdbc.queryForList("SELECT id,event_id,epoch,seq,kind,payload,created_at FROM scan_event WHERE platform=? AND profile_id=? AND run_id=? AND id>? ORDER BY id LIMIT 200",p,profile,run,Math.max(0,after));
        rows.forEach(r->r.put("payload",parse(r.get("payload")))); return rows;
    }
    public synchronized Map<String,Object> command(String p,long profile,String run,String kind,String id) {
        if(kind==null||!Set.of("PAUSE","RESUME","STOP").contains(kind)||id==null||!id.matches("[A-Za-z0-9_-]{1,120}")) fail("INVALID_COMMAND");
        return tx.execute(status->{
            var r=row(p,profile,run);
            var existing=jdbc.queryForList("SELECT * FROM scan_command WHERE id=?",id);
            if(!existing.isEmpty()) {
                var old=existing.getFirst();
                if(!p.equals(old.get("platform"))||profile!=n(old.get("profile_id"))||!run.equals(old.get("run_id"))||!kind.equals(old.get("kind"))) fail("COMMAND_ID_CONFLICT");
                return detail(p,profile,run);
            }
            var same=jdbc.queryForList("SELECT id FROM scan_command WHERE platform=? AND profile_id=? AND run_id=? AND kind=? AND status='PENDING'",p,profile,run,kind);
            if(!same.isEmpty() || ("STOP".equals(kind) && "STOPPED".equals(r.get("state"))) || ("PAUSE".equals(kind) && "PAUSED".equals(r.get("state")))) return detail(p,profile,run);
            if(TERMINAL.contains(r.get("state"))||"STOPPED".equals(r.get("desired"))) fail("SCAN_TERMINAL");
            int epoch=(int)n(r.get("epoch"));
            if("RESUME".equals(kind)) {
                if(!Set.of("PAUSED","BLOCKED").contains(r.get("state"))||System.currentTimeMillis()-n(r.get("page_seen_at"))>90000) fail("RESUME_REQUIRES_LIVE_CHECKPOINT");
                epoch++;
            }
            long now=System.currentTimeMillis();
            jdbc.update("UPDATE scan_command SET status='SUPERSEDED',updated_at=? WHERE platform=? AND profile_id=? AND run_id=? AND status='PENDING'",now,p,profile,run);
            jdbc.update("INSERT INTO scan_command(id,platform,profile_id,run_id,kind,epoch,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)",id,p,profile,run,kind,epoch,now,now);
            jdbc.update("UPDATE scan_run SET desired=?,epoch=?,last_seq=CASE WHEN epoch<>? THEN 0 ELSE last_seq END,updated_at=? WHERE platform=? AND profile_id=? AND run_id=?",switch(kind){case "PAUSE"->"PAUSED";case "STOP"->"STOPPED";default->"RESUMING";},epoch,epoch,now,p,profile,run);
            return detail(p,profile,run);
        });
    }
    public synchronized Map<String,Object> sync(String p,long profile,String run,Map<String,Object> body) {
        return tx.execute(status->{
            var r=row(p,profile,run); long now=System.currentTimeMillis(); int epoch=(int)n(r.get("epoch"));
            long supplied=n(body.get("epoch")); boolean current=supplied==epoch;
            jdbc.update("UPDATE scan_run SET background_seen_at=? WHERE platform=? AND profile_id=? AND run_id=?",now,p,profile,run);
            if(current && Boolean.TRUE.equals(body.get("pageAlive"))) jdbc.update("UPDATE scan_run SET page_seen_at=?,extension_version=?,content_version=? WHERE platform=? AND profile_id=? AND run_id=?",now,version(body.get("extensionVersion")),version(body.get("contentVersion")),p,profile,run);
            if(current && body.get("ack") instanceof Map<?,?> ack) {
                String id=Objects.toString(ack.get("id"),""); boolean ok=Boolean.TRUE.equals(ack.get("ok"));
                var cmds=jdbc.queryForList("SELECT * FROM scan_command WHERE id=? AND platform=? AND profile_id=? AND run_id=? AND epoch=? AND status='PENDING'",id,p,profile,run,epoch);
                if(!cmds.isEmpty()) {
                    String kind=cmds.getFirst().get("kind").toString();
                    jdbc.update("UPDATE scan_command SET status=?,error_code=?,updated_at=? WHERE id=?",ok?"ACKNOWLEDGED":"FAILED",code(ack.get("errorCode")),now,id);
                    String next=ok?switch(kind){case "STOP"->"STOPPED";case "PAUSE"->"PAUSED";default->"RUNNING";}:"BLOCKED";
                    jdbc.update("UPDATE scan_run SET state=?,desired=?,updated_at=? WHERE platform=? AND profile_id=? AND run_id=?",next,ok?next:"PAUSED",now,p,profile,run);
                }
            }
            var accepted=new ArrayList<String>();
            if(body.get("events") instanceof List<?> list) {
                if(list.size()>100) fail("EVENT_BATCH_TOO_LARGE");
                for(Object obj:list) {
                    if(!(obj instanceof Map<?,?> event)) continue;
                    String id=Objects.toString(event.get("eventId"),"");
                    if(!id.matches("[A-Za-z0-9_-]{1,120}")) fail("INVALID_EVENT_ID");
                    long ee=n(event.get("epoch")),seq=n(event.get("seq"));
                    var safe=sanitize(event); String kind=code(event.get("kind"));
                    int inserted=jdbc.update("INSERT OR IGNORE INTO scan_event(platform,profile_id,run_id,event_id,epoch,seq,kind,payload,created_at) VALUES(?,?,?,?,?,?,?,?,?)",p,profile,run,id,ee,seq,kind,write(safe),now);
                    accepted.add(id);
                    var latest=row(p,profile,run);
                    if(inserted==0||ee!=epoch||seq<=n(latest.get("last_seq"))) continue;
                    if("startFailure".equals(kind) && !"STARTING".equals(latest.get("state"))) continue;
                    String state=Objects.toString(safe.get("state"),latest.get("state").toString());
                    if(!Set.of("STARTING","RUNNING","PAUSED","BLOCKED","COMPLETE","PARTIAL","FAILED","STOPPED").contains(state)) state=latest.get("state").toString();
                    // Requests are not execution evidence. Only page acknowledgements may complete control transitions.
                    if(TERMINAL.contains(latest.get("state"))||!"RUNNING".equals(latest.get("desired"))) state=latest.get("state").toString();
                    String desired=Objects.toString(latest.get("desired"));
                    if("BLOCKED".equals(state)||"PAUSED".equals(state)) desired="PAUSED";
                    jdbc.update("UPDATE scan_run SET state=?,desired=?,stage=?,keyword=?,error_code=?,stop_reason=?,counters=?,last_seq=?,updated_at=? WHERE platform=? AND profile_id=? AND run_id=?",state,desired,safe.getOrDefault("stage",latest.get("stage")),safe.getOrDefault("keyword",latest.get("keyword")),safe.getOrDefault("errorCode",latest.get("error_code")),safe.getOrDefault("stopReason",latest.get("stop_reason")),mergeCounters(latest.get("counters"),safe.get("counters")),seq,now,p,profile,run);
                }
            }
            var latest=row(p,profile,run);
            return Map.of("success",true,"epoch",epoch,"state",latest.get("state"),"desired",latest.get("desired"),"acceptedEventIds",accepted,"commands",jdbc.queryForList("SELECT id,kind,epoch FROM scan_command WHERE platform=? AND profile_id=? AND run_id=? AND status='PENDING' ORDER BY created_at",key(p,profile,run)));
        });
    }
    private String mergeCounters(Object previous,Object incoming) {
        var merged=new LinkedHashMap<>(parse(previous));
        if(incoming instanceof Map<?,?> map) map.forEach((k,v)->merged.put(k.toString(),v));
        return write(merged);
    }
    private Map<String,Object> sanitize(Map<?,?> e) {
        Map<String,Object> out=new LinkedHashMap<>();
        if(n(e.get("observedAt"))>0) out.put("observedAt",Math.min(System.currentTimeMillis()+60000,n(e.get("observedAt"))));
        for(String k:List.of("stage","state","errorCode","stopReason")) if(e.containsKey(k)) out.put(k,code(e.get(k)));
        if(e.containsKey("keyword")) out.put("keyword",Objects.toString(e.get("keyword"),"").replaceAll("[\\p{Cntrl}]", " ").substring(0,Math.min(120,Objects.toString(e.get("keyword"),"").replaceAll("[\\p{Cntrl}]", " ").length())));
        if(e.get("counters") instanceof Map<?,?> counters) {
            Map<String,Object> safe=new LinkedHashMap<>();
            for(String k:List.of("read","duplicates","detailFailures","submissionFailures","keywordIndex","keywordTotal","httpStatus")) if(counters.containsKey(k)) safe.put(k,Math.max(0,Math.min(10000000,n(counters.get(k)))));
            out.put("counters",safe);
        }
        if(e.get("keywordResults") instanceof List<?> results) {
            List<Map<String,Object>> safeResults=new ArrayList<>();
            for(Object item:results.stream().limit(20).toList()) if(item instanceof Map<?,?> m) {
                Map<String,Object> k=new LinkedHashMap<>();
                k.put("keyword",Objects.toString(m.get("keyword"),"").replaceAll("[\\p{Cntrl}]"," ").substring(0,Math.min(120,Objects.toString(m.get("keyword"),"").length())));
                for(String field:List.of("read","duplicates","detailFailures","submissionFailures")) k.put(field,Math.max(0,Math.min(10000000,n(m.get(field)))));
                k.put("stopReason",code(m.get("stopReason")));k.put("outcome",code(m.get("outcome")));safeResults.add(k);
            }
            out.put("keywordResults",safeResults);
        }
        // Never persist arbitrary message/stack/URL/HTML or request/response bodies.
        return out;
    }
    static long n(Object v) { return v instanceof Number num?num.longValue():0; }
    static String code(Object v) { String s=Objects.toString(v,""); return s.matches("[A-Za-z0-9_:-]{0,80}")?s:"UNCLASSIFIED_ERROR"; }
    private String version(Object v) { String s=Objects.toString(v,"");return s.matches("[A-Za-z0-9._-]{1,60}")?s:""; }
    private String write(Object v) { try{return json.writeValueAsString(v);}catch(Exception e){throw new IllegalArgumentException("Invalid scan data");} }
    private Map<String,Object> parse(Object v) { try{return json.readValue(Objects.toString(v,"{}"),new TypeReference<>(){});}catch(Exception e){return Map.of();} }
    private static void fail(String code) { throw new ResponseStatusException(HttpStatus.CONFLICT,code); }
}
