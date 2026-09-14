-- Explicit, reversible links. A conversation can concern several opportunities.
CREATE TABLE opportunity_conversation (
    opportunity_id INTEGER NOT NULL REFERENCES opportunity(id),
    conversation_id INTEGER NOT NULL REFERENCES hr_conversation(id),
    profile_id INTEGER NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    source TEXT NOT NULL DEFAULT 'USER_CONFIRMED',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(opportunity_id,conversation_id)
);
CREATE INDEX idx_opportunity_conversation_active ON opportunity_conversation(conversation_id,active);
CREATE TRIGGER opportunity_conversation_identity BEFORE INSERT ON opportunity_conversation
WHEN NOT EXISTS(SELECT 1 FROM opportunity o JOIN hr_conversation c
    ON c.profile_id=o.profile_id AND c.platform=o.platform
    WHERE o.id=NEW.opportunity_id AND c.id=NEW.conversation_id AND o.profile_id=NEW.profile_id)
BEGIN SELECT RAISE(ABORT,'会话与机会不属于相同档案和平台'); END;
CREATE TRIGGER opportunity_conversation_identity_update BEFORE UPDATE ON opportunity_conversation
WHEN NEW.opportunity_id<>OLD.opportunity_id OR NEW.conversation_id<>OLD.conversation_id OR NEW.profile_id<>OLD.profile_id
BEGIN SELECT RAISE(ABORT,'会话关联身份不可修改'); END;

-- Message observations are suggestions to review, never confirmed recruiting outcomes.
-- Unlinked or multi-opportunity conversations cannot automatically attribute a message.
CREATE TRIGGER opportunity_inbound_observation AFTER INSERT ON hr_message
WHEN NEW.direction='INBOUND'
AND (SELECT COUNT(*) FROM opportunity_conversation WHERE conversation_id=NEW.conversation_id AND active=1)=1
BEGIN
    INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,observed_at,payload)
    SELECT l.opportunity_id,l.profile_id,'hr-observation:'||NEW.conversation_id||':'||NEW.fingerprint,
        'HR_INBOUND_OBSERVED','HR_OBSERVATION',NEW.observed_at,
        json_object('conversationId',NEW.conversation_id,'requiresConfirmation',1)
    FROM opportunity_conversation l WHERE l.conversation_id=NEW.conversation_id AND l.active=1
    ON CONFLICT(profile_id,event_key) DO NOTHING;
END;

CREATE TRIGGER opportunity_search_task AFTER INSERT ON job_analysis_task
WHEN NEW.status='PENDING' AND length(COALESCE(NEW.scan_run_id,''))>0
BEGIN
    INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload)
    SELECT o.id,NEW.profile_id,'search:'||json_array(NEW.platform,NEW.scan_run_id,NEW.job_key),
        'SEARCH_DISCOVERY','COLLECTOR',CURRENT_TIMESTAMP,
        json_object('keyword',json_extract(CASE WHEN json_valid(NEW.request_json) THEN NEW.request_json ELSE '{}' END,'$.keyword'),'scanRunId',NEW.scan_run_id)
    FROM opportunity o WHERE o.profile_id=NEW.profile_id AND o.platform=NEW.platform AND o.job_key=NEW.job_key
      AND length(COALESCE(json_extract(CASE WHEN json_valid(NEW.request_json) THEN NEW.request_json ELSE '{}' END,'$.keyword'),''))>0
    ON CONFLICT(profile_id,event_key) DO NOTHING;
END;

-- Persist future accepted discovery attribution without guessing old scan order.
CREATE TRIGGER opportunity_search_discovery AFTER UPDATE OF accepted ON fresh_scan_receipt
WHEN NEW.accepted=1 AND OLD.accepted<>1
BEGIN
    INSERT INTO opportunity_event(opportunity_id,profile_id,event_key,type,source,occurred_at,payload)
    SELECT o.id,NEW.profile_id,'search:'||json_array(NEW.platform,NEW.scan_run_id,NEW.job_key),
        'SEARCH_DISCOVERY','COLLECTOR',CURRENT_TIMESTAMP,
        json_object('keyword',NEW.keyword,'scanRunId',NEW.scan_run_id)
    FROM opportunity o WHERE o.profile_id=NEW.profile_id AND o.platform=NEW.platform AND o.job_key=NEW.job_key
    ON CONFLICT(profile_id,event_key) DO NOTHING;
END;
