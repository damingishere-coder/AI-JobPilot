-- Additive only. Historical and old-binary writes have no reliable execution phase.
ALTER TABLE delivery_attempt ADD COLUMN runtime_phase TEXT NOT NULL DEFAULT 'LEGACY';
ALTER TABLE delivery_attempt ADD COLUMN run_id TEXT;
ALTER TABLE delivery_attempt ADD COLUMN runtime_session_id TEXT;
ALTER TABLE delivery_attempt ADD COLUMN correlation_id TEXT;
ALTER TABLE delivery_attempt ADD COLUMN claim_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE delivery_attempt ADD COLUMN recovery_count INTEGER NOT NULL DEFAULT 0;

CREATE TABLE runtime_event (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    attempt_id INTEGER NOT NULL REFERENCES delivery_attempt(id),
    action_seq INTEGER NOT NULL,
    action TEXT NOT NULL,
    phase TEXT NOT NULL,
    page_type TEXT,
    blocker TEXT,
    evidence TEXT,
    detector_version TEXT,
    before_count INTEGER,
    after_count INTEGER,
    observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(attempt_id, action_seq)
);
CREATE INDEX idx_runtime_event_attempt ON runtime_event(attempt_id, id);

-- Result acceptance and the timeline commit together, including duplicate/late callback guards.
CREATE TRIGGER delivery_runtime_result AFTER UPDATE OF state ON delivery_attempt
WHEN NEW.state <> OLD.state AND NEW.runtime_phase <> 'LEGACY'
BEGIN
    INSERT INTO runtime_event(attempt_id, action_seq, action, phase, evidence)
    VALUES(NEW.id, (SELECT COALESCE(MAX(action_seq),0)+1 FROM runtime_event WHERE attempt_id=NEW.id),
        'VERIFY_APPLY', NEW.state, NEW.evidence);
    UPDATE delivery_attempt SET runtime_phase='SETTLED' WHERE id=NEW.id;
END;
