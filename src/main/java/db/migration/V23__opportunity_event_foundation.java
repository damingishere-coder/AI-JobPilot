package db.migration;

import org.flywaydb.core.api.migration.BaseJavaMigration;
import org.flywaydb.core.api.migration.Context;
import java.sql.Connection;
import java.sql.Statement;
import java.util.List;

/** Additive, self-contained migration. Never infers historical resume versions or outcome times. */
public class V23__opportunity_event_foundation extends BaseJavaMigration {
    @Override public void migrate(Context context) throws Exception {
        Connection connection=context.getConnection();
        try(Statement s=connection.createStatement()) {
            s.execute("""
                CREATE TABLE opportunity (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id INTEGER NOT NULL,
                  platform TEXT NOT NULL CHECK(platform IN ('boss','zhilian','liepin','51job')),
                  job_key TEXT NOT NULL CHECK(length(trim(job_key))>0), source_row_id INTEGER,
                  job_name TEXT, company_name TEXT, job_url TEXT, job_snapshot TEXT NOT NULL DEFAULT '{}',
                  stage TEXT NOT NULL DEFAULT 'DISCOVERED' CHECK(stage IN ('DISCOVERED','SHORTLISTED','APPLIED','RECRUITER_REPLIED','CHATTING','PHONE_SCREEN','INTERVIEW','OFFER','REJECTED','WITHDRAWN')),
                  interest TEXT NOT NULL DEFAULT 'UNDECIDED' CHECK(interest IN ('UNDECIDED','INTERESTED','NOT_INTERESTED')),
                  note_cipher TEXT, next_action_cipher TEXT, follow_up_at TEXT,
                  archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
                  version INTEGER NOT NULL DEFAULT 0, origin TEXT NOT NULL DEFAULT 'COLLECTOR',
                  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  UNIQUE(profile_id,platform,job_key)
                )
                """);
            s.execute("""
                CREATE TABLE opportunity_event (
                  id INTEGER PRIMARY KEY AUTOINCREMENT, opportunity_id INTEGER NOT NULL REFERENCES opportunity(id),
                  profile_id INTEGER NOT NULL, event_key TEXT NOT NULL, type TEXT NOT NULL, source TEXT NOT NULL,
                  occurred_at TEXT, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                  payload TEXT NOT NULL DEFAULT '{}', correction_of INTEGER REFERENCES opportunity_event(id), reason_cipher TEXT,
                  UNIQUE(profile_id,event_key)
                )
                """);
            s.execute("CREATE INDEX idx_opportunity_profile_stage ON opportunity(profile_id,archived,stage,updated_at)");
            s.execute("CREATE INDEX idx_opportunity_event_timeline ON opportunity_event(opportunity_id,id)");
            s.execute("CREATE TRIGGER opportunity_event_immutable BEFORE UPDATE ON opportunity_event BEGIN SELECT RAISE(ABORT,'求职事件只能追加更正'); END");
            s.execute("CREATE TRIGGER opportunity_event_profile BEFORE INSERT ON opportunity_event WHEN NEW.profile_id<>(SELECT profile_id FROM opportunity WHERE id=NEW.opportunity_id) BEGIN SELECT RAISE(ABORT,'求职事件档案不一致'); END");
            s.execute("CREATE TRIGGER opportunity_unresolved_delete BEFORE DELETE ON opportunity WHEN EXISTS(SELECT 1 FROM delivery_attempt a WHERE a.profile_id=OLD.profile_id AND a.platform=OLD.platform AND a.job_key=OLD.job_key AND a.state IN('REQUESTED','UNKNOWN')) OR EXISTS(SELECT 1 FROM job_analysis_task t WHERE t.profile_id=OLD.profile_id AND t.platform=OLD.platform AND t.job_key=OLD.job_key AND t.status IN('LEASED','UNKNOWN')) BEGIN SELECT RAISE(ABORT,'未决求职记录不能删除'); END");
            s.execute("""
                CREATE TRIGGER opportunity_discovered AFTER INSERT ON opportunity BEGIN
                  INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at)
                  VALUES(NEW.id,NEW.profile_id,'opportunity:'||NEW.id||':discovered','DISCOVERED',NEW.origin,
                    CASE WHEN NEW.origin='LEGACY_IMPORT' THEN NULL ELSE CURRENT_TIMESTAMP END);
                END
                """);
            List<Platform> platforms=List.of(
                new Platform("boss","boss_data","encrypt_id","job_name","company_name","job_url","salary","location","job_description","company_scale"),
                new Platform("zhilian","zhilian_data","job_id","job_title","company_name","job_link","salary","location","job_description",null),
                new Platform("liepin","liepin_data","job_id","job_title","comp_name","job_link","job_salary_text","job_area",null,"comp_scale"),
                new Platform("51job","job51_data","job_id","job_title","comp_name","job_link","job_salary_text","job_area",null,"comp_scale"));
            for(Platform p:platforms) {
                s.execute(capture(p,"j."," FROM "+p.table()+" j","LEGACY_IMPORT"));
                for(String operation:List.of("INSERT","UPDATE"))
                    s.execute("CREATE TRIGGER opportunity_capture_"+p.table()+"_"+operation.toLowerCase()+" AFTER "+operation+" ON "+p.table()+" BEGIN "+capture(p,"NEW.","","COLLECTOR")+"; END");
                s.execute("CREATE TRIGGER opportunity_protect_"+p.table()+" BEFORE DELETE ON "+p.table()+
                    " WHEN EXISTS(SELECT 1 FROM opportunity o WHERE o.profile_id=OLD.profile_id AND o.platform='"+p.platform()+"' AND o.job_key=trim(CAST(OLD."+p.key()+" AS TEXT))) " +
                    "BEGIN SELECT RAISE(ABORT,'岗位已有求职历史，请归档而非删除'); END");
            }
            // Attempts whose original job cache was already removed remain traceable by stable key.
            s.execute("""
                INSERT INTO opportunity(profile_id,platform,job_key,origin)
                SELECT DISTINCT a.profile_id,a.platform,trim(a.job_key),'LEGACY_IMPORT' FROM delivery_attempt a
                WHERE a.profile_id IN(SELECT id FROM profile) AND a.platform IN('boss','zhilian','liepin','51job')
                  AND length(trim(COALESCE(a.job_key,'')))>0
                ON CONFLICT(profile_id,platform,job_key) DO NOTHING
                """);
            s.execute(applicationEvent("a."," FROM delivery_attempt a","LEGACY_IMPORT",true));
            s.execute("UPDATE opportunity SET stage='APPLIED' WHERE EXISTS(SELECT 1 FROM delivery_attempt a WHERE a.profile_id=opportunity.profile_id AND a.platform=opportunity.platform AND trim(a.job_key)=opportunity.job_key AND a.state='CONFIRMED' AND COALESCE(a.evidence,'')<>'EXISTING_CONVERSATION' AND NOT EXISTS(SELECT 1 FROM runtime_event e WHERE e.attempt_id=a.id AND e.evidence IN('ALREADY_APPLIED','ALREADY_CONTACTED')))");
            s.execute("CREATE TRIGGER opportunity_archived_dispatch BEFORE INSERT ON delivery_attempt WHEN EXISTS(SELECT 1 FROM opportunity o WHERE o.profile_id=NEW.profile_id AND o.platform=NEW.platform AND o.job_key=trim(NEW.job_key) AND o.archived=1) BEGIN SELECT RAISE(ABORT,'请先恢复已归档的求职机会'); END");
            for(String operation:List.of("INSERT","UPDATE OF state")) {
                String condition=operation.startsWith("UPDATE")?" WHEN NEW.state<>OLD.state ":" ";
                s.execute("CREATE TRIGGER opportunity_application_"+(operation.startsWith("UPDATE")?"update":"insert")+" AFTER "+operation+" ON delivery_attempt"+condition+"BEGIN " +
                    "INSERT INTO opportunity(profile_id,platform,job_key) SELECT NEW.profile_id,NEW.platform,trim(NEW.job_key) WHERE NEW.profile_id IN(SELECT id FROM profile) AND length(trim(COALESCE(NEW.job_key,'')))>0 ON CONFLICT(profile_id,platform,job_key) DO NOTHING; " +
                    applicationEvent("NEW.","","APPLICATION_SERVICE",false)+"; " +
                    "UPDATE opportunity SET stage='APPLIED',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE profile_id=NEW.profile_id AND platform=NEW.platform AND job_key=trim(NEW.job_key) AND stage IN('DISCOVERED','SHORTLISTED') AND NEW.state='CONFIRMED' AND COALESCE(NEW.evidence,'')<>'EXISTING_CONVERSATION' " +
                    "AND NOT EXISTS(SELECT 1 FROM runtime_event WHERE attempt_id=NEW.id AND evidence IN('ALREADY_APPLIED','ALREADY_CONTACTED')); END");
            }
            s.execute("""
                CREATE TRIGGER opportunity_analysis AFTER INSERT ON job_ai_analysis BEGIN
                  INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,payload)
                  SELECT o.id,NEW.profile_id,'analysis:'||NEW.id,'AI_ANALYZED','AI',
                    json_object('analysisId',NEW.id,'score',NEW.score,'decision',NEW.decision,'resumeVersionId',NEW.resume_version_id)
                  FROM opportunity o WHERE o.profile_id=NEW.profile_id AND o.platform=NEW.platform AND o.job_key=trim(NEW.job_key)
                  ON CONFLICT(profile_id,event_key) DO NOTHING;
                END
                """);
            for(String table:List.of("job_ai_analysis","job_analysis_task"))
                s.execute("CREATE TRIGGER opportunity_protect_"+table+" BEFORE DELETE ON "+table+" WHEN EXISTS(SELECT 1 FROM opportunity o WHERE o.profile_id=OLD.profile_id AND o.platform=lower(OLD.platform) AND o.job_key=trim(OLD.job_key)) BEGIN SELECT RAISE(ABORT,'分析已有求职历史，请归档而非删除'); END");
        }
    }

    private String capture(Platform p,String row,String from,String source) {
        String key="trim(CAST("+row+p.key()+" AS TEXT))";
        String snapshot="json_object('salary',"+row+p.salary()+",'location',"+row+p.location()+",'description',"+(p.description()==null?"NULL":row+p.description())+",'companyScale',"+(p.scale()==null?"NULL":row+p.scale())+")";
        return "INSERT INTO opportunity(profile_id,platform,job_key,source_row_id,job_name,company_name,job_url,job_snapshot,origin) SELECT " +
            row+"profile_id,'"+p.platform()+"',"+key+","+row+"id,"+row+p.title()+","+row+p.company()+","+row+p.url()+","+snapshot+",'"+source+"'"+from+
            " WHERE "+row+"profile_id IN(SELECT id FROM profile) AND length(COALESCE("+key+",''))>0 AND "+key+"<>'0' " +
            "ON CONFLICT(profile_id,platform,job_key) DO UPDATE SET source_row_id=excluded.source_row_id,job_name=excluded.job_name,company_name=excluded.company_name,job_url=excluded.job_url,job_snapshot=excluded.job_snapshot,updated_at=CURRENT_TIMESTAMP,version=opportunity.version+1 " +
            "WHERE opportunity.source_row_id IS NOT excluded.source_row_id OR opportunity.job_name IS NOT excluded.job_name OR opportunity.company_name IS NOT excluded.company_name OR opportunity.job_url IS NOT excluded.job_url OR opportunity.job_snapshot<>excluded.job_snapshot";
    }

    private String applicationEvent(String row,String from,String source,boolean legacy) {
        String id=row+"id",profile=row+"profile_id",platform=row+"platform",key="trim("+row+"job_key)",state=row+"state";
        String evidence="CASE WHEN "+row+"evidence IN('GREETING_RENDERED_EXACT','GREETING_MANUAL_RECONCILIATION','MANUAL_RECONCILIATION','PLATFORM_STATUS_TEXT','PLATFORM_SUCCESS_DIALOG','EXISTING_CONVERSATION','LEGACY_STATUS_IMPORT','NO_CONFIRMATION','PRE_ACTION_ERROR','PLATFORM_ERROR','BATCH_HALTED_BEFORE_ACTION','USER_CONFIRMED') THEN "+row+"evidence ELSE 'UNCLASSIFIED' END";
        String opportunity="(SELECT o.id FROM opportunity o WHERE o.profile_id="+profile+" AND o.platform="+platform+" AND o.job_key="+key+")";
        // Freeze the analysis association on confirmation. Later callbacks reuse the original
        // request event, so intervening re-analysis cannot rewrite attribution.
        String analysis="(SELECT a.id FROM job_ai_analysis a WHERE a.profile_id="+profile+" AND a.platform="+platform+" AND a.job_key="+key+" ORDER BY a.id DESC LIMIT 1)";
        String snapshot="(SELECT json(job_snapshot) FROM opportunity WHERE id="+opportunity+")";
        String context=legacy?"NULL":"CASE WHEN "+state+"='REQUESTED' THEN json_object('analysisId',"+analysis+",'jobSnapshot',json("+snapshot+"),'actualSentResumeVersionId',NULL) ELSE json((SELECT json_extract(e.payload,'$.context') FROM opportunity_event e WHERE e.profile_id="+profile+" AND e.event_key='attempt:'||"+id+"||':REQUESTED')) END";
        String incomplete=legacy?"1":"CASE WHEN "+state+"='REQUESTED' THEN 0 ELSE COALESCE((SELECT json_extract(e.payload,'$.historicalContextUnknown') FROM opportunity_event e WHERE e.profile_id="+profile+" AND e.event_key='attempt:'||"+id+"||':REQUESTED'),1) END";
        return "INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload) SELECT "+opportunity+","+profile+",'attempt:'||"+id+"||':'||"+state+",'APPLICATION_'||"+state+",'"+source+"',"+(legacy?"NULL":"CURRENT_TIMESTAMP")+"," +
            "json_object('attemptId',"+id+",'state',"+state+",'evidence',"+evidence+",'historicalContextUnknown',"+incomplete+",'context',"+context+")"+from+
            " WHERE "+opportunity+" IS NOT NULL ON CONFLICT(profile_id,event_key) DO NOTHING";
    }
    private record Platform(String platform,String table,String key,String title,String company,String url,String salary,String location,String description,String scale) {}
}
