package com.getjobs.application.service;

import java.sql.Connection;
import java.sql.SQLException;
import java.util.Map;

/** Shared archive boundary for the existing platform pages; retains all underlying facts. */
public final class OpportunityArchive {
    private OpportunityArchive() {}
    public static String visible(String platform,String table,String key) {
        if(!java.util.Set.of("boss","zhilian","liepin","51job").contains(platform)) throw new IllegalArgumentException("未知平台");
        return "NOT EXISTS(SELECT 1 FROM opportunity archived_op WHERE archived_op.profile_id="+table+".profile_id AND archived_op.platform='"+platform+"' AND archived_op.job_key=trim(CAST("+table+"."+key+" AS TEXT)) AND archived_op.archived=1)";
    }

    public static void requireIdle(Connection connection,String platform,long profile) throws SQLException {
        try(var query=connection.prepareStatement("SELECT COUNT(*) FROM interview i JOIN opportunity o ON o.id=i.opportunity_id WHERE o.profile_id=? AND o.platform=? AND o.archived=0 AND i.status='SCHEDULED'")) {
            query.setLong(1,profile);query.setString(2,platform);
            try(var rows=query.executeQuery()) { if(rows.next() && rows.getLong(1)>0) throw new IllegalStateException("仍有已安排面试，请先完成或取消后归档"); }
        }
        for(String table:new String[]{"job_analysis_task","delivery_attempt"}) {
            String predicate=table.equals("job_analysis_task")?"status IN ('PENDING','LEASED','UNKNOWN')":"state IN ('REQUESTED','UNKNOWN')";
            try(var query=connection.prepareStatement("SELECT COUNT(*) FROM "+table+" WHERE profile_id=? AND lower(platform)=? AND "+predicate)) {
                query.setLong(1,profile);query.setString(2,platform);
                try(var rows=query.executeQuery()) {
                    if(rows.next() && rows.getLong(1)>0) throw new IllegalStateException("仍有排队、执行中或 UNKNOWN 任务，请先完成或对账后归档");
                }
            }
        }
    }

    public static Map<String,Object> platform(Connection connection,String platform,long profile) throws SQLException {
        try(var lock=connection.createStatement()) { lock.executeUpdate("UPDATE opportunity SET version=version WHERE id=-1"); }
        requireIdle(connection,platform,profile);
        int count;
        try(var events=connection.prepareStatement("INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,payload) " +
            "SELECT id,profile_id,'archive:'||id||':'||version,'ARCHIVED','USER',json_object('previousVersion',version) FROM opportunity WHERE profile_id=? AND platform=? AND archived=0")) {
            events.setLong(1,profile);events.setString(2,platform);events.executeUpdate();
        }
        try(var update=connection.prepareStatement("UPDATE opportunity SET archived=1,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE profile_id=? AND platform=? AND archived=0")) {
            update.setLong(1,profile);update.setString(2,platform);count=update.executeUpdate();
        }
        String table=platform.equals("boss")?"boss_data":"zhilian_data";
        String key=platform.equals("boss")?"encrypt_id":"job_id";
        long remaining;
        try(var query=connection.prepareStatement("SELECT COUNT(*) FROM "+table+" WHERE profile_id=? AND "+visible(platform,table,key))) {
            query.setLong(1,profile);
            try(var rows=query.executeQuery()) { remaining=rows.next()?rows.getLong(1):0; }
        }
        return Map.of("success",true,"message","已归档 "+count+" 个机会，历史已保留，可在求职机会中恢复。"+(remaining>0?"另有 "+remaining+" 条无法关联机会的旧岗位保留在列表。":""), "archivedCount",count,
            "jobsDeleted",0,"analysisDeleted",0,"tasksDeleted",0,"draftsDeleted",0,"total",remaining);
    }
}
