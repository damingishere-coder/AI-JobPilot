CREATE TABLE interview (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    opportunity_id INTEGER NOT NULL REFERENCES opportunity(id),
    profile_id INTEGER NOT NULL,
    round_number INTEGER NOT NULL CHECK(round_number BETWEEN 1 AND 100),
    scheduled_at TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Shanghai',
    mode TEXT NOT NULL CHECK(mode IN ('ONLINE','PHONE','ONSITE','OTHER')),
    status TEXT NOT NULL CHECK(status IN ('PENDING','SCHEDULED','COMPLETED','CANCELLED')),
    preparation_json TEXT NOT NULL DEFAULT '[]',
    note_cipher TEXT,
    version INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(opportunity_id,round_number),
    CHECK(status<>'SCHEDULED' OR scheduled_at IS NOT NULL)
);
CREATE INDEX idx_interview_profile_schedule ON interview(profile_id,status,scheduled_at);
CREATE TRIGGER interview_identity BEFORE INSERT ON interview
WHEN NOT EXISTS(SELECT 1 FROM opportunity WHERE id=NEW.opportunity_id AND profile_id=NEW.profile_id)
BEGIN SELECT RAISE(ABORT,'面试与机会档案不一致'); END;
CREATE TRIGGER interview_identity_update BEFORE UPDATE ON interview
WHEN NEW.opportunity_id<>OLD.opportunity_id OR NEW.profile_id<>OLD.profile_id
BEGIN SELECT RAISE(ABORT,'面试所属机会不可修改'); END;
CREATE TRIGGER opportunity_scheduled_interview_archive BEFORE UPDATE OF archived ON opportunity
WHEN NEW.archived=1 AND OLD.archived=0 AND EXISTS(SELECT 1 FROM interview WHERE opportunity_id=OLD.id AND status='SCHEDULED')
BEGIN SELECT RAISE(ABORT,'仍有已安排面试，请先完成或取消后归档'); END;
