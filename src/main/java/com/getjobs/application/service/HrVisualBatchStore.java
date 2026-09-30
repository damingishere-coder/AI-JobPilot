package com.getjobs.application.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrVisualTypes;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.util.*;

/** Durable discovery checkpoints. Raw chat/identity/observations remain encrypted. */
@Service
@RequiredArgsConstructor
@DependsOn("databaseSchemaService")
public class HrVisualBatchStore {
    private final JdbcTemplate db;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;
    public record Batch(String id,Long profile,String account,String status,String stage,boolean coverage,JsonNode cursor) { }
    public record Item(String id,String batch,String kind,JsonNode contact,String status,Long conversation,String run) { }
    public Batch latest(Long profile) {
        var rows=db.queryForList("SELECT id FROM hr_visual_batch WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT 1",String.class,profile);
        return rows.isEmpty()?null:get(profile,rows.getFirst());
    }
    public Batch get(Long profile,String id) {
        return db.queryForObject("SELECT * FROM hr_visual_batch WHERE profile_id=? AND id=?",(r,n)->new Batch(id,profile,
                crypto.decrypt(r.getString("account_cipher"),"batch-account:"+id),r.getString("status"),r.getString("stage"),
                r.getBoolean("coverage_complete"),decode(r.getString("cursor_cipher"),"batch-cursor:"+id)),profile,id);
    }
    public boolean active(Long profile) {var b=latest(profile);return b!=null && Set.of("STARTING","RUNNING").contains(b.status());}
    public boolean busy() {return count("SELECT COUNT(*) FROM hr_visual_batch WHERE status IN ('STARTING','RUNNING')")>0;}
    public boolean processingDiscovered(String id){return count("SELECT COUNT(*) FROM hr_visual_batch WHERE id=? AND process_discovered=1",id)>0;}
    public boolean direct(String id){return count("SELECT COUNT(*) FROM hr_visual_batch WHERE id=? AND reply_mode='AUTO' AND text_authorized_at IS NOT NULL",id)>0;}
    public boolean directAuthorized(String id,String hash){return direct(id) && count("SELECT COUNT(*) FROM hr_visual_batch WHERE id=? AND text_authorization_hash=?",id,hash)>0;}
    public void processDiscovered(String id,String mode,String hash) {
        db.update("UPDATE hr_visual_batch SET process_discovered=1,reply_mode=?,text_authorization_hash=?,text_authorized_at=?,cursor_cipher=NULL WHERE id=?",
                mode,hash,mode.equals("AUTO")?System.currentTimeMillis():null,id);
    }
    public void clearNavigationCursor(String id){db.update("UPDATE hr_visual_batch SET cursor_cipher=NULL WHERE id=?",id);}
    public void autoReviewed(String item){db.update("UPDATE hr_visual_batch_item SET auto_reviewed=1 WHERE id=?",item);}
    public boolean needsAutoReview(String item){return count("SELECT COUNT(*) FROM hr_visual_batch_item WHERE id=? AND auto_reviewed=0",item)>0;}
    public void automaticText(String item,String hash){db.update("UPDATE hr_visual_batch_item SET auto_reviewed=1,text_facts_hash=? WHERE id=?",hash,item);}
    public boolean automaticText(String run){return count("SELECT COUNT(*) FROM hr_visual_batch_item WHERE run_id=? AND text_facts_hash<>''",run)>0;}
    public boolean textFactsMatch(String run,String hash){return count("SELECT COUNT(*) FROM hr_visual_batch_item WHERE run_id=? AND text_facts_hash=? AND text_facts_hash<>''",run,hash)>0;}
    public String existing(Long profile,String key,String hash) {
        var rows=db.queryForList("SELECT id,request_hash FROM hr_visual_batch WHERE profile_id=? AND request_key=?",profile,key);
        if(rows.isEmpty())return null;
        if(!hash.equals(rows.getFirst().get("request_hash")))throw new IllegalArgumentException("同一启动请求内容已变化");
        return (String)rows.getFirst().get("id");
    }
    public String requestHash(Object request){return crypto.blindIndex(json.valueToTree(request).toString(),"visual-batch-start");}
    public String create(Long profile,String account,String key,String hash) {
        String id=UUID.randomUUID().toString();long now=System.currentTimeMillis();
        db.update("INSERT INTO hr_visual_batch(id,profile_id,request_key,request_hash,protocol,account_cipher,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)",
                id,profile,key,hash,HrVisualTypes.PROTOCOL,crypto.encrypt(account,"batch-account:"+id),now,now);
        return id;
    }
    public boolean reserveOpen(String id) {return db.update("UPDATE hr_visual_batch SET open_reserved=1 WHERE id=? AND open_reserved=0",id)==1;}
    public void state(String id,String status,String stage,String reason) {
        db.update("UPDATE hr_visual_batch SET status=?,stage=?,reason=?,updated_at=? WHERE id=?",status,stage,reason,System.currentTimeMillis(),id);
    }
    public List<Item> items(String id) {
        return db.query("SELECT * FROM hr_visual_batch_item WHERE batch_id=? ORDER BY CASE kind WHEN 'ANCHOR' THEN 0 ELSE 1 END,rowid",(r,n)->
                new Item(r.getString("id"),id,r.getString("kind"),decode(r.getString("contact_cipher"),"batch-contact:"+r.getString("id")),
                        r.getString("status"),r.getObject("conversation_id")==null?null:r.getLong("conversation_id"),r.getString("run_id")),id);
    }
    public void add(String batch,String kind,JsonNode contact,Long conversation) {
        String id=UUID.randomUUID().toString(),key=identity(contact.path("hrName").asText(),contact.path("companyName").asText());
        db.update("INSERT OR IGNORE INTO hr_visual_batch_item(id,batch_id,identity_hash,contact_cipher,kind,conversation_id) VALUES (?,?,?,?,?,?)",
                id,batch,key,encode(contact,"batch-contact:"+id),kind,conversation);
    }
    public String identity(String hr,String company) {return crypto.blindIndex(HrVisualService.normalize(hr)+"|"+HrVisualService.normalize(company),"visual-batch-identity");}
    public void page(String id,JsonNode result) {
        for(var contact:result.path("contacts"))add(id,"CONTACT",contact,null);
        boolean stalled="NO_PROGRESS".equals(result.path("coverage").asText());
        boolean gap=result.path("coverageGap").asBoolean();
        var previousCursor=decode(db.queryForObject("SELECT cursor_cipher FROM hr_visual_batch WHERE id=?",String.class,id),"batch-cursor:"+id);
        var overlapping=new HashSet<String>();
        if(previousCursor!=null)for(var key:previousCursor.path("keys"))overlapping.add(crypto.blindIndex(key.asText(),"visual-batch-identity"));
        var prior=decode(db.queryForObject("SELECT current_pass_cipher FROM hr_visual_batch WHERE id=?",String.class,id),"batch-enumeration:"+id);
        var sequence=json.createArrayNode();var seen=new HashMap<String,String>();
        if(prior!=null)for(var entry:prior){sequence.add(entry);seen.put(entry.path("identity").asText(),entry.path("preview").asText());}
        for(var contact:result.path("contacts")){
            String key=identity(contact.path("hrName").asText(),contact.path("companyName").asText()),preview=contact.path("previewKey").asText();
            if(seen.containsKey(key)){
                if(!seen.get(key).equals(preview) || !overlapping.contains(key)) {
                    gap=true;
                    db.update("UPDATE hr_visual_batch_item SET status='BLOCKED',reason='跨屏出现重复身份或预览变化，不能唯一关联联系人' WHERE batch_id=? AND kind='CONTACT' AND identity_hash=? AND status='PENDING'",id,key);
                }
            }
            else {sequence.add(json.valueToTree(Map.of("identity",key,"preview",preview)));seen.put(key,preview);}
        }
        db.update("UPDATE hr_visual_batch SET current_pass_cipher=? WHERE id=?",encode(sequence,"batch-enumeration:"+id),id);
        db.update("UPDATE hr_visual_batch SET cursor_cipher=?,coverage_complete=CASE WHEN coverage_gap=0 AND ?=0 THEN ? ELSE 0 END,coverage_gap=MAX(coverage_gap,?),page_count=page_count+1,stalled_pages=CASE WHEN ? THEN stalled_pages+1 ELSE 0 END WHERE id=?",
                encode(result.path("cursor"),"batch-cursor:"+id),gap?1:0,result.path("coverageComplete").asBoolean()?1:0,gap?1:0,stalled,id);
    }
    /** Two complete enumerations must agree before an entire list is claimed. No page reload. */
    public boolean confirmDiscovery(String id) {
        var row=db.queryForMap("SELECT pass_no,coverage_complete,current_pass_cipher,first_pass_cipher FROM hr_visual_batch WHERE id=?",id);
        if(((Number)row.get("pass_no")).intValue()==1 && ((Number)row.get("coverage_complete")).intValue()==1) {
            db.update("UPDATE hr_visual_batch SET pass_no=2,first_pass_cipher=current_pass_cipher,current_pass_cipher=NULL,cursor_cipher=NULL,coverage_complete=0,stalled_pages=0,page_count=0 WHERE id=?",id);
            return false;
        }
        var first=decode((String)row.get("first_pass_cipher"),"batch-enumeration:"+id);
        var second=decode((String)row.get("current_pass_cipher"),"batch-enumeration:"+id);
        if(first==null || !first.equals(second))db.update("UPDATE hr_visual_batch SET coverage_complete=0,coverage_gap=1,reason='两次列表枚举不一致，可能发生联系人重排；覆盖未完成' WHERE id=?",id);
        return true;
    }
    public boolean discoveryLimit(String id){return count("SELECT COUNT(*) FROM hr_visual_batch WHERE id=? AND (stalled_pages>=3 OR page_count>=200)",id)>0;}
    public void resetCursor(String id){db.update("UPDATE hr_visual_batch SET cursor_cipher=NULL,stalled_pages=0,coverage_gap=0,coverage_complete=0,page_count=0,pass_no=1,first_pass_cipher=NULL,current_pass_cipher=NULL WHERE id=?",id);}
    public void checkpointTop(String id,JsonNode result) {
        if(!result.path("cursor").path("seekingTop").asBoolean() || !result.path("contacts").isArray() || !result.path("contacts").isEmpty() || result.path("coverageComplete").asBoolean())
            throw new IllegalStateException("顶部定位进度无效，未计入联系人列表");
        var old=decode(db.queryForObject("SELECT cursor_cipher FROM hr_visual_batch WHERE id=?",String.class,id),"batch-cursor:"+id);
        int attempts=old==null?1:old.path("topAttempts").asInt()+1;
        if(attempts>20)throw new IllegalStateException("定位列表顶部达到本轮上限，已暂停");
        db.update("UPDATE hr_visual_batch SET cursor_cipher=? WHERE id=?",encode(Map.of("seekingTop",true,"topAttempts",attempts),"batch-cursor:"+id),id);
    }
    public boolean recheckable(Item item) {
        if(item.run()!=null || item.conversation()!=null)return false;
        if(Set.of("READ_FAILED","DATE_UNKNOWN").contains(item.status()))return true;
        if(!"BLOCKED".equals(item.status()))return false;
        String reason=db.queryForObject("SELECT reason FROM hr_visual_batch_item WHERE id=?",String.class,item.id());
        return "BLOCKED".equals(item.status()) && "存在未核验发送，无法排除联系人更名；新视觉身份暂不自动分享简历".equals(reason);
    }
    public void outcome(String item,String status,String reason) {db.update("UPDATE hr_visual_batch_item SET status=?,reason=? WHERE id=?",status,reason,item);}
    public void observed(String item){db.update("UPDATE hr_visual_batch_item SET observed_at=? WHERE id=?",System.currentTimeMillis(),item);}
    public void link(String item,long conversation,String run,Object resumeRequest) {
        db.update("UPDATE hr_visual_batch_item SET conversation_id=?,run_id=?,status='LINKED',request_cipher=? WHERE id=?",conversation,run,
                resumeRequest==null?null:encode(resumeRequest,"batch-request:"+run),item);
    }
    public String owner(String run){var ids=db.queryForList("SELECT batch_id FROM hr_visual_batch_item WHERE run_id=?",String.class,run);return ids.isEmpty()?null:ids.getFirst();}
    public JsonNode resumeRequest(String run) {var rows=db.queryForList("SELECT request_cipher FROM hr_visual_batch_item WHERE run_id=?",String.class,run);return rows.isEmpty()?null:decode(rows.getFirst(),"batch-request:"+run);}
    public boolean allows(Long profile,String run) {
        String id=owner(run);if(id==null)return true;
        Batch b=get(profile,id);return Set.of("RUNNING","FINISHED","INCOMPLETE").contains(b.status()) &&
                !Set.of("BOOTSTRAP","ANCHORS","POSITION_LIST").contains(b.stage()) && verifiedAnchors(id).containsAll(unknownConversations(profile));
    }
    public void resetAnchors(String id,String nextStage) {
        db.update("UPDATE hr_visual_batch_item SET status='PENDING' WHERE batch_id=? AND kind='ANCHOR'",id);
        db.update("UPDATE hr_visual_batch SET after_anchors=? WHERE id=?",nextStage,id);
    }
    public String afterAnchors(String id){return db.queryForObject("SELECT after_anchors FROM hr_visual_batch WHERE id=?",String.class,id);}
    public boolean anchorsVerified(String id) {
        return count("SELECT COUNT(*) FROM hr_visual_batch_item WHERE batch_id=? AND kind='ANCHOR' AND status<>'VERIFIED'",id)==0;
    }
    public Set<Long> verifiedAnchors(String id) {
        return new HashSet<>(db.queryForList("SELECT conversation_id FROM hr_visual_batch_item WHERE batch_id=? AND kind='ANCHOR' AND status='VERIFIED'",Long.class,id));
    }
    public List<Long> unknownConversations(Long profile) {
        return db.queryForList("SELECT DISTINCT conversation_id FROM hr_reply_proposal WHERE profile_id=? AND status='SEND_UNKNOWN'",Long.class,profile);
    }
    public List<Long> exclusions(Long profile) {
        return db.queryForList("SELECT DISTINCT t.conversation_id FROM hr_visual_target t JOIN hr_visual_run r ON r.id=t.run_id WHERE r.profile_id=? AND NOT EXISTS(SELECT 1 FROM hr_visual_batch_item b WHERE b.run_id=r.id)",Long.class,profile);
    }
    public void observation(Long profile,JsonNode event) {
        boolean success=Set.of("LIST_READY","LIST_READY_NO_SELECTION","BODY_VERIFIED").contains(event.path("stage").asText());
        String encrypted=encode(event,"visual-observation:"+profile);
        db.update("""
            INSERT INTO hr_visual_observation(profile_id,current_cipher,last_success_cipher,updated_at) VALUES (?,?,?,?)
            ON CONFLICT(profile_id) DO UPDATE SET current_cipher=excluded.current_cipher,
            last_success_cipher=COALESCE(excluded.last_success_cipher,hr_visual_observation.last_success_cipher),updated_at=excluded.updated_at
            """,profile,encrypted,success?encrypted:null,System.currentTimeMillis());
    }
    public Map<String,Object> observation(Long profile) {
        var rows=db.queryForList("SELECT * FROM hr_visual_observation WHERE profile_id=?",profile);
        if(rows.isEmpty())return Map.of();var row=rows.getFirst();
        var result=new LinkedHashMap<String,Object>();result.put("current",decode((String)row.get("current_cipher"),"visual-observation:"+profile));
        result.put("lastSuccess",decode((String)row.get("last_success_cipher"),"visual-observation:"+profile));result.put("updatedAt",row.get("updated_at"));return result;
    }
    public Map<String,Object> status(Long profile) {
        Batch b=latest(profile);if(b==null)return Map.of();
        return status(profile,b.id());
    }
    public Map<String,Object> status(Long profile,String id) {
        Batch b=get(profile,id);
        var result=new LinkedHashMap<String,Object>();result.put("id",b.id());result.put("status",b.status());result.put("stage",b.stage());result.put("coverageComplete",b.coverage());
        result.put("reason",db.queryForObject("SELECT reason FROM hr_visual_batch WHERE id=?",String.class,b.id()));
        result.put("replyMode",direct(id)?"AUTO":"REVIEW");result.put("processingDiscovered",processingDiscovered(id));
        var list=new ArrayList<Map<String,Object>>();
        for(var item:items(b.id())) {
            var r=new LinkedHashMap<String,Object>();r.put("id",item.id());r.put("kind",item.kind());r.put("hrName",item.contact().path("hrName").asText());r.put("companyName",item.contact().path("companyName").asText());
            r.put("status",item.status());r.put("reason",db.queryForObject("SELECT reason FROM hr_visual_batch_item WHERE id=?",String.class,item.id()));
            r.put("canRecheck",item.kind().equals("CONTACT") && recheckable(item));
            r.put("observedAt",db.queryForObject("SELECT observed_at FROM hr_visual_batch_item WHERE id=?",Long.class,item.id()));
            if(item.run()!=null) {
                var targets=db.queryForList("SELECT proposal_id,status,reason FROM hr_visual_target WHERE run_id=?",item.run());
                if(!targets.isEmpty())r.putAll(targets.getFirst());r.put("runId",item.run());
                Object proposal=r.get("proposal_id");
                if(proposal!=null){var notices=db.queryForList("SELECT status FROM hr_qq_delivery WHERE profile_id=? AND dedupe_key LIKE ? ORDER BY created_at DESC,rowid DESC LIMIT 1",String.class,profile,"proposal:"+proposal+":%");r.put("notificationStatus",notices.isEmpty()?"NOT_QUEUED":notices.getFirst());}
            }
            list.add(r);
        }
        var statusCounts=new LinkedHashMap<String,Long>();
        for(var item:list)if("CONTACT".equals(item.get("kind")))statusCounts.merge(Objects.toString(item.get("status")),1L,Long::sum);
        result.put("statusCounts",statusCounts);
        result.put("pending",statusCounts.entrySet().stream().filter(e->Set.of("PENDING","PRIORITY_PENDING","PENDING_CAPTURE","LINKED","QUEUED","PREPARED","SUBMITTING","PARTIAL").contains(e.getKey())).mapToLong(Map.Entry::getValue).sum());
        result.put("noReply",statusCounts.getOrDefault("SKIPPED",0L));result.put("excluded",statusCounts.getOrDefault("EXCLUDED",0L));
        result.put("unknown",statusCounts.getOrDefault("SEND_UNKNOWN",0L));result.put("blocked",statusCounts.getOrDefault("BLOCKED",0L));
        result.put("readFailed",statusCounts.getOrDefault("READ_FAILED",0L));result.put("dateUnknown",statusCounts.getOrDefault("DATE_UNKNOWN",0L));
        result.put("stale",statusCounts.getOrDefault("STALE",0L));
        // A later unknown resume must not hide an earlier confirmed text receipt.
        // Commands retain their visual run ownership even after explicit reconfirmation replaces a target's proposal.
        var receipts=db.queryForList("""
            SELECT s.action_type,s.status,COUNT(DISTINCT s.id) AS receipt_count FROM hr_send_step s
            JOIN hr_send_command c ON c.command_id=s.command_id
            JOIN hr_visual_batch_item i ON c.watch_session_id='visual:'||i.run_id
            WHERE i.batch_id=? AND i.kind='CONTACT' AND c.profile_id=? AND c.transport='WINDOWS_VISUAL'
              AND s.status IN ('SENT_CONFIRMED','SEND_UNKNOWN') GROUP BY s.action_type,s.status
            """,id,profile);
        long texts=0,resumes=0,unknownSteps=0;
        for(var receipt:receipts){long count=((Number)receipt.get("receipt_count")).longValue();
            if("SEND_UNKNOWN".equals(receipt.get("status")))unknownSteps+=count;
            else if("TEXT".equals(receipt.get("action_type")))texts=count;
            else if("RESUME_NATIVE".equals(receipt.get("action_type")))resumes=count;
        }
        result.put("textSentConfirmed",texts);result.put("resumeSentConfirmed",resumes);result.put("unknownSteps",unknownSteps);
        result.put("items",list);result.put("discovered",list.stream().filter(i->"CONTACT".equals(i.get("kind"))).count());
        result.put("checked",list.stream().filter(i->"CONTACT".equals(i.get("kind")) && i.get("observedAt")!=null).count());
        result.put("pendingReview",statusCounts.getOrDefault("REVIEW_REQUIRED",0L));
        result.put("sent",statusCounts.getOrDefault("SENT_CONFIRMED",0L));return result;
    }
    public void recover(){db.update("UPDATE hr_visual_batch SET status='PAUSED',reason='服务重启，保留进度；明确恢复后继续，不重新开页' WHERE status IN ('STARTING','RUNNING')");}
    private int count(String sql,Object...args){return Objects.requireNonNull(db.queryForObject(sql,Integer.class,args));}
    private String encode(Object value,String aad){try{return crypto.encrypt(json.writeValueAsString(value),aad);}catch(Exception e){throw new IllegalStateException("批次记录加密失败",e);}}
    private JsonNode decode(String value,String aad){if(value==null)return null;try{return json.readTree(crypto.decrypt(value,aad));}catch(Exception e){throw new IllegalStateException("批次记录不可核验",e);}}
}
