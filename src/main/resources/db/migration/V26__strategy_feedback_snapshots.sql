CREATE TABLE strategy_snapshot (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    request_key TEXT NOT NULL,
    window_days INTEGER NOT NULL CHECK(window_days IN(30,90)),
    cutoff TEXT NOT NULL,
    through_event_id INTEGER NOT NULL,
    rule_version TEXT NOT NULL,
    result_json TEXT NOT NULL,
    decisions_json TEXT NOT NULL DEFAULT '{}',
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_id,request_key)
);
CREATE INDEX idx_strategy_snapshot_profile ON strategy_snapshot(profile_id,id);
CREATE TRIGGER strategy_snapshot_immutable BEFORE UPDATE ON strategy_snapshot
WHEN NEW.profile_id<>OLD.profile_id OR NEW.request_key<>OLD.request_key OR NEW.window_days<>OLD.window_days
 OR NEW.cutoff<>OLD.cutoff OR NEW.through_event_id<>OLD.through_event_id OR NEW.rule_version<>OLD.rule_version OR NEW.result_json<>OLD.result_json
BEGIN SELECT RAISE(ABORT,'策略统计快照不可重写'); END;

-- V23 froze salary/JD but not the public title. Preserve the title at future confirmation;
-- existing requests remain explicitly unknown instead of borrowing a later re-scan title.
CREATE TRIGGER opportunity_application_attribution AFTER INSERT ON opportunity_event
WHEN NEW.type='APPLICATION_REQUESTED' AND NEW.source='APPLICATION_SERVICE'
BEGIN
    INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload)
    SELECT o.id,o.profile_id,'attribution:'||json_extract(NEW.payload,'$.attemptId'),'APPLICATION_ATTRIBUTION','APPLICATION_SERVICE',NEW.occurred_at,
        json_object('attemptId',json_extract(NEW.payload,'$.attemptId'),'requestEventId',NEW.id,'jobTitle',o.job_name,'companyName',o.company_name)
    FROM opportunity o WHERE o.id=NEW.opportunity_id
    ON CONFLICT(profile_id,event_key) DO NOTHING;
END;
