package com.getjobs.application.service;

import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.*;

/** Immutable analysis inputs. No credentials or browser resume assumptions. */
@Service
@RequiredArgsConstructor
public class AnalysisContextService {
    public static final String RULE = "job-evidence-20260914-v1";
    private final JdbcTemplate jdbc;
    private final ObjectMapper json;
    private final HrAssistantCryptoService crypto;
    private final ConfigService config;
    private final GreetingPolicy greetingPolicy;

    public long saveResumeVersion(long profileId, String text) {
        String content = Objects.toString(text, "");
        String fingerprint = digest(content);
        jdbc.update("INSERT INTO resume_version(profile_id,content_fingerprint,content_cipher) VALUES(?,?,?) ON CONFLICT DO NOTHING",
            profileId,fingerprint,crypto.encrypt(content,"resume-version:"+profileId+":"+fingerprint));
        return jdbc.queryForObject("SELECT id FROM resume_version WHERE profile_id=? AND content_fingerprint=?",Long.class,profileId,fingerprint);
    }

    public void freeze(JobAiAnalysisService.JobAnalysisRequest request) {
        long profile = request.getProfileId();
        List<String> resumes = jdbc.query("SELECT COALESCE(resume_text,'') FROM resume_profile WHERE profile_id=? ORDER BY updated_at DESC,id DESC LIMIT 1",
            (rs,n)->rs.getString(1),profile);
        long version = saveResumeVersion(profile,resumes.isEmpty()?"":resumes.getFirst());
        var configs = jdbc.queryForList("SELECT introduce,apply_threshold,priority_apply_threshold FROM ai WHERE profile_id=? ORDER BY updated_at DESC,id DESC LIMIT 1",profile);
        Map<String,Object> settings = configs.isEmpty()?Map.of():configs.getFirst();
        String company = Objects.toString(request.getCompanyName(),"").trim();
        boolean priority = !company.isEmpty() && jdbc.query("SELECT company_name FROM priority_company WHERE profile_id=? AND (enabled=1 OR enabled IS NULL)",
            (rs,n)->Objects.toString(rs.getString(1),"").trim(),profile).stream().filter(s->!s.isEmpty()).anyMatch(s->company.contains(s)||s.contains(company));
        int threshold = number(settings.get(priority?"priority_apply_threshold":"apply_threshold"),priority?JobAiAnalysisService.DEFAULT_PRIORITY_APPLY_THRESHOLD:JobAiAnalysisService.DEFAULT_APPLY_THRESHOLD);
        Map<String,String> provider = config.getAiConfigs();
        String type = Objects.toString(provider.get("AI_PROVIDER"),"");
        var basis = new Basis(version,"zhilian".equalsIgnoreCase(request.getPlatform())?Objects.toString(settings.get("introduce"),""):"",
            priority,threshold,providerIdentity(provider),type,Objects.toString(provider.get("codex".equalsIgnoreCase(type)?"CODEX_MODEL":"MODEL"),""),RULE,greetingPolicy.urlFor(profile));
        try {
            String encoded = json.writeValueAsString(basis);
            request.setAnalysisContext(crypto.encrypt(encoded,aad(request)));
            request.setContextKey(digest(encoded));
            request.setRuntimeContext(null);
        } catch(Exception error) { throw new IllegalStateException("无法冻结分析输入",error); }
    }

    public void hydrate(JobAiAnalysisService.JobAnalysisRequest request) {
        if(request.getAnalysisContext()==null || request.getContextKey()==null)
            throw new IllegalStateException("历史任务缺少冻结的分析上下文，未调用 AI；请在岗位页面重新提交分析");
        try {
            String encoded = crypto.decrypt(request.getAnalysisContext(),aad(request));
            if(!digest(encoded).equals(request.getContextKey())) throw new IllegalStateException("分析上下文指纹不一致");
            Basis basis = json.readValue(encoded,Basis.class);
            if(!RULE.equals(basis.rule())) throw new IllegalStateException("分析规则版本已变化，请显式重新分析");
            var row = jdbc.queryForMap("SELECT content_fingerprint,content_cipher FROM resume_version WHERE id=? AND profile_id=?",basis.resumeVersionId(),request.getProfileId());
            String text = crypto.decrypt((String)row.get("content_cipher"),"resume-version:"+request.getProfileId()+":"+row.get("content_fingerprint"));
            if(!digest(text).equals(row.get("content_fingerprint"))) throw new IllegalStateException("简历版本内容不一致");
            request.setRuntimeContext(new Frozen(basis,text));
        } catch(IllegalStateException error) { throw error; }
        catch(Exception error) { throw new IllegalStateException("分析快照无法读取，已停止调用 AI",error); }
    }

    public static String providerIdentity(Map<String,String> config) {
        var identity = new TreeMap<String,String>();
        for(String key:List.of("AI_PROVIDER","MODEL","CODEX_MODEL","BASE_URL","CODEX_PATH","CODEX_HOME","CODEX_TIMEOUT_SECONDS","AI_REQUEST_TIMEOUT_SECONDS"))
            identity.put(key,Objects.toString(config.get(key),""));
        // Store only a digest of non-secret routing parameters, never API keys.
        return digest(identity.entrySet().stream().map(e->e.getKey().length()+":"+e.getKey()+e.getValue().length()+":"+e.getValue()).reduce("",String::concat));
    }
    private String aad(JobAiAnalysisService.JobAnalysisRequest request) { return "analysis-context:"+request.getProfileId()+":"+request.getPlatform().toLowerCase(Locale.ROOT)+":"+request.getJobKey(); }
    private int number(Object value,int fallback) { return value instanceof Number n?Math.max(0,Math.min(100,n.intValue())):fallback; }
    private static String digest(String value) {
        try { return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(value.getBytes(StandardCharsets.UTF_8))); }
        catch(Exception error) { throw new IllegalStateException("无法计算分析指纹",error); }
    }
    public record Basis(long resumeVersionId,String introduction,boolean priority,int threshold,String providerIdentity,String provider,String model,String rule,String portfolioUrl) {}
    public record Frozen(Basis basis,String resumeText) {
        @Override public String toString() { return "Frozen[resumeVersionId="+basis.resumeVersionId()+"]"; }
    }
}
