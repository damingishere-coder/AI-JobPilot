package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.getjobs.application.hr.HrAssistantTypes.*;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.DependsOn;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/** Durable encrypted captures. A receipt acknowledges storage, never an AI decision or a send. */
@Service
@DependsOn("databaseSchemaService")
@RequiredArgsConstructor
public class HrBackgroundStore {
    private final JdbcTemplate db;
    private final HrAssistantCryptoService crypto;
    private final ObjectMapper json;
    private final HrAssistantStore hr;
    private final HrAutopilotStore policies;

    public record CaptureAck(boolean accepted,String captureId,boolean duplicate,String queueStatus) { }
    public record Task(String id,Long profileId,int policyVersion,ChatCapture capture) { }

    private String accountHash(Long profile,String identity) {
        return crypto.blindIndex(normalize(identity),"hr-background-account:"+profile);
    }

    @Transactional
    public CaptureAck accept(Long profile,String account,int version,ChatCapture capture) {
        String encoded=encode(capture);
        if(encoded.length()>2_000_000)throw new IllegalArgumentException("单条聊天快照过大");
        String key=crypto.blindIndex(capture.captureId(),"hr-background-capture:"+profile);
        String digest=crypto.blindIndex(sourceEvidence(capture),"hr-background-payload:"+profile);
        String id=UUID.randomUUID().toString();
        int inserted=db.update("""
                INSERT OR IGNORE INTO hr_background_capture(id,profile_id,capture_key,payload_hash,
                  payload_cipher,account_hash,policy_version) VALUES (?,?,?,?,?,?,?)
                """,id,profile,key,digest,crypto.encrypt(encoded,"background-capture:"+id),accountHash(profile,account),version);
        var row=db.queryForMap("SELECT id,payload_hash,payload_cipher,account_hash,status,error_code,policy_version FROM hr_background_capture WHERE profile_id=? AND capture_key=?",profile,key);
        if(!accountHash(profile,account).equals(row.get("account_hash")))
            throw new HrAssistantStore.StaleProposalException("采集编号对应的正文或账号已变化，未覆盖原快照");
        boolean upgrade=false;
        ChatCapture previous=null;
        if(inserted==0 && capture.contextComplete() && row.get("payload_cipher") instanceof String oldCipher && !oldCipher.isBlank()) {
            previous=decode(crypto.decrypt(oldCipher,"background-capture:"+row.get("id")));
            upgrade=!previous.contextComplete() && compatibleIdentity(previous.session(),capture.session())
                    && sourceRound(previous).equals(sourceRound(capture));
        }
        if(!digest.equals(row.get("payload_hash")) && !upgrade)throw new HrAssistantStore.StaleProposalException("采集编号对应的正文或身份已变化，未覆盖原快照");
        boolean freshAuthorization=inserted==0 && ((Number)row.get("policy_version")).intValue()!=version
                && ("PENDING".equals(row.get("status")) || ("BLOCKED".equals(row.get("status")) && "AUTHORIZATION_CHANGED".equals(row.get("error_code"))));
        boolean freshSuggestion=inserted==0 && capture.contextComplete() && "DONE".equals(row.get("status"))
                && unchangedSuggestion(profile,capture,version);
        boolean freshIdentity=inserted==0 && previous!=null && capture.contextComplete() && completeIdentity(capture.session())
                && "BLOCKED".equals(row.get("status")) && "LEGACY_IDENTITY_UNRESOLVED".equals(row.get("error_code"))
                && identityHash(profile,previous.session()).equals(identityHash(profile,capture.session()))
                && identityDependencyResolved(profile,capture);
        if(upgrade || freshAuthorization || freshSuggestion || freshIdentity) {
            String originalId=row.get("id").toString();
            // A source observed during the initial baseline stays historical even
            // when a later complete read or identity retry comes from a live scan.
            if(previous==null && row.get("payload_cipher") instanceof String oldCipher && !oldCipher.isBlank())
                previous=decode(crypto.decrypt(oldCipher,"background-capture:"+originalId));
            if(previous!=null && previous.historical() && !capture.historical())
                encoded=encode(new ChatCapture(capture.captureId(),capture.unreadCount(),capture.session(),capture.messages(),true,capture.contextComplete()));
            db.update("UPDATE hr_background_capture SET payload_cipher=?,payload_hash=?,policy_version=?,status='PENDING',error_code='',updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    crypto.encrypt(encoded,"background-capture:"+originalId),digest,version,originalId);
            return new CaptureAck(true,capture.captureId(),true,"PENDING");
        }
        return new CaptureAck(true,capture.captureId(),inserted==0,row.get("status").toString());
    }

    /** Storage retries analysis only after identity evidence changes; never resolve or send here. */
    private boolean identityDependencyResolved(Long profile,ChatCapture capture) {
        String uidHash=crypto.blindIndex(capture.session().uid(),"conversation:"+profile);
        var aliases=db.queryForList("SELECT identity_hash FROM hr_chrome_conversation_alias WHERE profile_id=? AND chrome_uid_hash=?",String.class,profile,uidHash);
        if(!aliases.isEmpty())return aliases.size()==1 && identityHash(profile,capture.session()).equals(aliases.getFirst());
        var matches=new ArrayList<Long>();
        var sources=new ArrayList<Long>();
        for(Long candidate:db.queryForList("SELECT id FROM hr_conversation WHERE profile_id=? AND platform='boss_visual'",Long.class,profile)) {
            try {
                var baseline=policies.context(profile,candidate);
                if(sameVisualIdentity(capture.session(),baseline.session())) {
                    matches.add(candidate);
                    if(baseline.contextComplete() && completeIdentity(baseline.session())
                            && !uniqueSourceRound(capture.messages(),baseline.messages()).isEmpty())sources.add(candidate);
                }
            }catch(IdentityHeldException ambiguity){return false;}
            catch(RuntimeException unavailable){ /* The worker retains its original fail-closed checks. */ }
        }
        if(!matches.isEmpty())return matches.size()==1 && sources.size()==1
                && db.queryForObject("SELECT COUNT(*) FROM hr_chrome_conversation_alias WHERE profile_id=? AND conversation_id=?",Integer.class,profile,sources.getFirst())==0;
        if(db.queryForObject("SELECT COUNT(*) FROM hr_conversation WHERE profile_id=? AND platform='boss' AND external_uid_hash=?",Integer.class,profile,uidHash)>0)return true;
        return independentOfUnresolvedVisualIdentities(profile,capture);
    }

    private boolean unchangedSuggestion(Long profile,ChatCapture capture,int version) {
        String uidHash=crypto.blindIndex(capture.session().uid(),"conversation:"+profile);
        var conversations=db.queryForList("""
                SELECT conversation_id FROM hr_chrome_conversation_alias WHERE profile_id=? AND chrome_uid_hash=?
                UNION SELECT id FROM hr_conversation WHERE profile_id=? AND platform='boss' AND external_uid_hash=?
                """,Long.class,profile,uidHash,profile,uidHash);
        if(conversations.size()!=1 || capture.messages().isEmpty() || !capture.messages().getLast().inbound())return false;
        long conversation=conversations.getFirst();
        String source=sourceFingerprint(profile,conversation,capture,capture.messages().getLast());
        return hr.hasUnchangedBackgroundSuggestion(profile,conversation,source,version);
    }

    /** Only unfinished analysis is recovered; send leases have their separate UNKNOWN recovery. */
    public void recover() {
        db.update("UPDATE hr_background_capture SET status='PENDING',updated_at=CURRENT_TIMESTAMP WHERE status='PROCESSING'");
    }

    @Transactional
    public Task claim(Long profile,String account,int version) {
        String accountHash=accountHash(profile,account);
        db.update("UPDATE hr_background_capture SET status='BLOCKED',error_code='AUTHORIZATION_CHANGED',updated_at=CURRENT_TIMESTAMP WHERE profile_id=? AND account_hash=? AND status='PENDING' AND policy_version<>?",profile,accountHash,version);
        var ids=db.queryForList("SELECT id FROM hr_background_capture WHERE profile_id=? AND account_hash=? AND policy_version=? AND status='PENDING' ORDER BY created_at,rowid LIMIT 1",String.class,profile,accountHash,version);
        if(ids.isEmpty()) {
            // Recover only stored analysis whose identity dependency is now proven.
            // Payload, account, authorization, and historical scope remain immutable;
            // any later send still requires the real page's fresh whole source round.
            for(var row:db.queryForList("SELECT id,payload_cipher FROM hr_background_capture WHERE profile_id=? AND account_hash=? AND policy_version=? AND status='BLOCKED' AND error_code='LEGACY_IDENTITY_UNRESOLVED' ORDER BY created_at,rowid",profile,accountHash,version)) {
                try {
                    String id=row.get("id").toString();
                    var capture=decode(crypto.decrypt(Objects.toString(row.get("payload_cipher"),""),"background-capture:"+id));
                    if(!capture.contextComplete() || !completeIdentity(capture.session()) || !identityDependencyResolved(profile,capture))continue;
                    if(db.update("UPDATE hr_background_capture SET status='PENDING',error_code='',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='BLOCKED' AND error_code='LEGACY_IDENTITY_UNRESOLVED'",id)==1) {
                        ids=List.of(id);break;
                    }
                }catch(RuntimeException unavailable){ /* Missing evidence stays held. */ }
            }
        }
        if(ids.isEmpty())return null;
        String id=ids.getFirst();
        if(db.update("UPDATE hr_background_capture SET status='PROCESSING',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PENDING'",id)!=1)return null;
        String cipher=db.queryForObject("SELECT payload_cipher FROM hr_background_capture WHERE id=?",String.class,id);
        return new Task(id,profile,version,decode(crypto.decrypt(cipher,"background-capture:"+id)));
    }

    public void finish(String id,String errorCode) {
        db.update("UPDATE hr_background_capture SET status=?,error_code=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PROCESSING'",errorCode.isBlank()?"DONE":"BLOCKED",errorCode,id);
    }
    public void defer(String id) {
        db.update("UPDATE hr_background_capture SET status='PENDING',updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='PROCESSING'",id);
    }
    public int pending(Long profile) {
        return db.queryForObject("SELECT COUNT(*) FROM hr_background_capture WHERE profile_id=? AND status IN ('PENDING','PROCESSING')",Integer.class,profile);
    }

    /** Read-only evidence for the active profile; inspection never retries analysis or a send. */
    public List<Map<String,Object>> inspectCaptures(Long profile,int size) {
        var rows=db.queryForList("SELECT id,status,error_code,created_at,updated_at,payload_cipher FROM hr_background_capture WHERE profile_id=? ORDER BY created_at DESC,rowid DESC LIMIT ?",profile,Math.max(1,Math.min(size,50)));
        return rows.stream().map(row->{
            var result=new LinkedHashMap<String,Object>();
            for(String key:List.of("id","status","error_code","created_at","updated_at"))result.put(key,row.get(key));
            try {
                String cipher=Objects.toString(row.get("payload_cipher"),"");
                if(!cipher.isBlank())result.put("capture",decode(crypto.decrypt(cipher,"background-capture:"+row.get("id"))));
            }catch(RuntimeException unavailable){ /* Retain metadata when expired or unreadable. */ }
            result.put("contextAvailable",result.containsKey("capture"));
            return (Map<String,Object>)result;
        }).toList();
    }

    public Map<String,Object> captureDiagnostics(Long profile,int version) {
        int blocked=db.queryForObject("SELECT COUNT(*) FROM hr_background_capture WHERE profile_id=? AND policy_version=? AND status='BLOCKED'",Integer.class,profile,version);
        return Map.of("blockedCaptures",blocked,"unresolvedLegacyIdentities",unresolvedVisualIdentities(profile).size(),
                "message",blocked>0?"有 "+blocked+" 条聊天记录处理受阻，尚未发送回复。":"");
    }

    private List<Long> unresolvedVisualIdentities(Long profile) {
        return db.queryForList("""
                SELECT DISTINCT c.id FROM hr_conversation c JOIN hr_reply_proposal p ON p.conversation_id=c.id
                WHERE c.profile_id=? AND c.platform='boss_visual' AND p.status IN ('SEND_UNKNOWN','BLOCKED')
                  AND NOT EXISTS (SELECT 1 FROM hr_chrome_conversation_alias a WHERE a.profile_id=c.profile_id AND a.conversation_id=c.id)
                """,Long.class,profile);
    }

    /** Different people at different companies can proceed without releasing any old UNKNOWN. */
    private boolean independentOfUnresolvedVisualIdentities(Long profile,ChatCapture observed) {
        var unresolved=unresolvedVisualIdentities(profile);
        if(unresolved.isEmpty())return true;
        if(!observed.contextComplete() || !completeIdentity(observed.session()))return false;
        int end=observed.messages().size();while(end>0 && !observed.messages().get(end-1).inbound())end--;
        int start=end;while(start>0 && observed.messages().get(start-1).inbound())start--;
        var round=observed.messages().subList(start,end);
        if(round.isEmpty() || round.stream().anyMatch(m->Objects.toString(m.messageId(),"").isBlank())
                || round.stream().map(ChatMessage::messageId).distinct().count()!=round.size())return false;
        for(Long id:unresolved) {
            try {
                var baseline=policies.context(profile,id);
                if(!baseline.contextComplete() || !completeIdentity(baseline.session())
                        || baseline.messages().stream().noneMatch(ChatMessage::inbound)
                        || normalize(observed.session().hrName()).equals(normalize(baseline.session().hrName()))
                        || normalize(observed.session().companyName()).equals(normalize(baseline.session().companyName()))
                        || !uniqueSourceRound(observed.messages(),baseline.messages()).isEmpty())return false;
            }catch(RuntimeException unavailable){return false;}
        }
        return true;
    }

    public List<Map<String,Object>> legacyAnchors(Long profile) {
        var ids=db.queryForList("""
                SELECT DISTINCT c.id FROM hr_conversation c JOIN hr_reply_proposal p ON p.conversation_id=c.id
                WHERE c.profile_id=? AND c.platform='boss_visual' AND p.status IN ('SEND_UNKNOWN','BLOCKED')
                  AND NOT EXISTS (SELECT 1 FROM hr_chrome_conversation_alias a WHERE a.profile_id=c.profile_id AND a.conversation_id=c.id)
                """,Long.class,profile);
        return ids.stream().map(id->{
            var result=new LinkedHashMap<String,Object>();result.put("conversationId",id);
            try {result.put("capture",policies.context(profile,id));result.put("status","READ_ONLY");}
            catch(RuntimeException unavailable){result.put("status","CONTEXT_UNAVAILABLE");}
            return (Map<String,Object>)result;
        }).toList();
    }

    public void purgeExpired() {
        // Keep dedupe keys while expiring sensitive snapshots independently.
        db.update("UPDATE hr_background_capture SET status='BLOCKED',error_code='CAPTURE_EXPIRED',payload_cipher='' WHERE status IN ('PENDING','PROCESSING') AND created_at<datetime('now','-30 days')");
        db.update("UPDATE hr_background_capture SET payload_cipher='' WHERE status IN ('DONE','BLOCKED') AND updated_at<datetime('now','-30 days')");
        db.update("UPDATE hr_chrome_conversation_alias SET evidence_cipher='' WHERE created_at<datetime('now','-30 days')");
    }

    /** Preserve canonical IDs and fingerprints when returning from the visual transport. */
    @Transactional
    public long resolveConversation(Long profile,ChatCapture observed) {
        ChatSession identity=observed.session();
        if(identity.uid().startsWith("visual:"))throw new IllegalArgumentException("后台 Chrome 必须提供平台会话 UID");
        String uidHash=crypto.blindIndex(identity.uid(),"conversation:"+profile);
        String identityHash=identityHash(profile,identity);
        var aliases=db.queryForList("SELECT conversation_id,identity_hash FROM hr_chrome_conversation_alias WHERE profile_id=? AND chrome_uid_hash=?",profile,uidHash);
        if(!aliases.isEmpty()) {
            if(!identityHash.equals(aliases.getFirst().get("identity_hash")))throw new IdentityHeldException();
            return ((Number)aliases.getFirst().get("conversation_id")).longValue();
        }
        var visualIds=db.queryForList("SELECT id FROM hr_conversation WHERE profile_id=? AND platform='boss_visual'",Long.class,profile);
        var identityMatches=new ArrayList<Long>();
        var sourceMatches=new ArrayList<Long>();
        for(Long candidate:visualIds) {
            try {
                ChatCapture baseline=policies.context(profile,candidate);
                if(sameVisualIdentity(identity,baseline.session())) {
                    identityMatches.add(candidate);
                    if(completeIdentity(identity) && baseline.contextComplete() && observed.contextComplete()
                            && !uniqueSourceRound(observed.messages(),baseline.messages()).isEmpty())sourceMatches.add(candidate);
                }
            }catch(IdentityHeldException e){throw e;}
            catch(RuntimeException unavailable) {
                // An unavailable baseline is never used as identity evidence.
            }
        }
        if(!identityMatches.isEmpty()) {
            if(identityMatches.size()!=1 || sourceMatches.size()!=1)throw new IdentityHeldException();
            long canonical=sourceMatches.getFirst();
            if(db.queryForObject("SELECT COUNT(*) FROM hr_chrome_conversation_alias WHERE profile_id=? AND conversation_id=?",Integer.class,profile,canonical)>0)
                throw new IdentityHeldException();
            ChatCapture baseline=policies.context(profile,canonical);
            ChatMessage oldSource=baseline.messages().stream().filter(ChatMessage::inbound).reduce((first,last)->last).orElseThrow(IdentityHeldException::new);
            db.update("INSERT INTO hr_chrome_conversation_alias(profile_id,chrome_uid_hash,chrome_uid_cipher,conversation_id,identity_hash,source_round_hash,legacy_source_fingerprint,evidence_cipher) VALUES (?,?,?,?,?,?,?,?)",
                    profile,uidHash,crypto.encrypt(identity.uid(),"chrome-alias:"+profile+":"+uidHash),canonical,identityHash,
                    crypto.blindIndex(encode(roundEvidence(uniqueSourceRound(observed.messages(),baseline.messages()))),"chrome-alias-source:"+profile+":"+canonical),hr.sourceFingerprint(canonical,oldSource),
                    crypto.encrypt(encode(observed),"chrome-alias-evidence:"+profile+":"+uidHash));
            return canonical;
        }
        var direct=db.queryForList("SELECT id FROM hr_conversation WHERE profile_id=? AND platform='boss' AND external_uid_hash=?",Long.class,profile,uidHash);
        if(!direct.isEmpty())return direct.getFirst();
        // Ambiguous or incomplete new UIDs remain held. Verified unrelated
        // identities do not clear, alias, or replay the old unknown conversation.
        if(!independentOfUnresolvedVisualIdentities(profile,observed))throw new IdentityHeldException();
        return hr.upsertConversation(profile,identity);
    }

    public String sourceFingerprint(Long profile,long conversation,ChatCapture capture,ChatMessage source) {
        String roundHash=crypto.blindIndex(encode(sourceRound(capture)),"chrome-alias-source:"+profile+":"+conversation);
        var old=db.queryForList("SELECT legacy_source_fingerprint FROM hr_chrome_conversation_alias WHERE profile_id=? AND conversation_id=? AND source_round_hash=?",String.class,profile,conversation,roundHash);
        return old.isEmpty()?hr.sourceFingerprint(conversation,source):old.getFirst();
    }

    public static boolean completeIdentity(ChatSession session) {
        return session!=null && !normalize(session.hrName()).isEmpty() && !normalize(session.companyName()).isEmpty() && !normalize(session.jobName()).isEmpty();
    }
    private String identityHash(Long profile,ChatSession identity) {
        if(identity==null)return "";
        return crypto.blindIndex(normalize(identity.hrName())+"|"+normalize(identity.companyName())+"|"+normalize(identity.jobName()),"hr-background-identity:"+profile);
    }
    private static boolean sameVisualIdentity(ChatSession observed,ChatSession baseline) {
        return baseline!=null && normalize(observed.hrName()).equals(normalize(baseline.hrName()))
                && normalize(observed.companyName()).equals(normalize(baseline.companyName()))
                && canonicalJob(observed.jobName()).equals(canonicalJob(baseline.jobName()));
    }
    private static String canonicalJob(String job) {
        // Older visual snapshots sometimes concatenate the short job title and
        // its expanded title. Remove only an exact repeated leading title;
        // different roles still require their own complete identity evidence.
        String value=normalize(job);
        return value.length()>200?value:value.replaceFirst("^(.{4,}?)\\1", "$1");
    }
    private static List<ChatMessage> uniqueSourceRound(List<ChatMessage> observed,List<ChatMessage> baseline) {
        int end=baseline.size();while(end>0 && !baseline.get(end-1).inbound())end--;
        int start=end;while(start>0 && baseline.get(start-1).inbound())start--;
        var round=baseline.subList(start,end);
        if(round.isEmpty())return List.of();
        List<ChatMessage> found=List.of();
        for(int offset=0;offset+round.size()<=observed.size();offset++) {
            if(offset>0 && observed.get(offset-1).inbound())continue;
            if(offset+round.size()<observed.size() && observed.get(offset+round.size()).inbound())continue;
            boolean match=true;
            for(int j=0;j<round.size();j++)match &= sameMessage(observed.get(offset+j),round.get(j));
            if(match) {
                if(!found.isEmpty())throw new IdentityHeldException();
                found=observed.subList(offset,offset+round.size());
            }
        }
        return found;
    }
    public static boolean sameMessage(ChatMessage left,ChatMessage right) {
        return left.inbound()==right.inbound() && normalize(left.type()).equals(normalize(right.type()))
                && normalize(left.time()).equals(normalize(right.time())) && normalize(left.text()).equals(normalize(right.text()));
    }
    private static String normalize(String text) {return Objects.toString(text,"").replaceAll("\\s+","").strip();}
    private String sourceEvidence(ChatCapture capture) {
        var identity=capture.session();
        return encode(List.of(identity.uid(),normalize(identity.hrName()),normalize(identity.companyName()),normalize(identity.jobName()),sourceRound(capture)));
    }
    private List<String> sourceRound(ChatCapture capture) {
        int end=capture.messages().size();while(end>0 && !capture.messages().get(end-1).inbound())end--;
        int start=end;while(start>0 && capture.messages().get(start-1).inbound())start--;
        return roundEvidence(capture.messages().subList(start,end));
    }
    private List<String> roundEvidence(List<ChatMessage> round) {
        return round.stream().map(m->encode(List.of(normalize(m.type()),normalize(m.time()),normalize(m.text()),Objects.toString(m.messageId(),"")))).toList();
    }
    private boolean compatibleIdentity(ChatSession old,ChatSession fresh) {
        return old.uid().equals(fresh.uid()) && compatiblePart(old.hrName(),fresh.hrName())
                && compatiblePart(old.companyName(),fresh.companyName()) && compatiblePart(old.jobName(),fresh.jobName());
    }
    private boolean compatiblePart(String old,String fresh) {return normalize(old).isBlank() || normalize(old).equals(normalize(fresh));}
    private String encode(Object value) {try{return json.writeValueAsString(value);}catch(Exception e){throw new IllegalStateException("后台采集快照无法保存",e);}}
    private ChatCapture decode(String value) {try{return json.readValue(value,ChatCapture.class);}catch(Exception e){throw new IllegalStateException("后台采集快照无法读取",e);}}
    public static class IdentityHeldException extends IllegalStateException {
        public IdentityHeldException(){super("LEGACY_IDENTITY_UNRESOLVED: 旧视觉会话的身份或完整来源轮尚未核验，仅保留只读快照，不发送");}
    }
}
