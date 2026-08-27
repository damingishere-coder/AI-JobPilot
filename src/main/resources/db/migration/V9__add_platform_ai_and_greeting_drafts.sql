ALTER TABLE liepin_data ADD COLUMN ai_score INTEGER;
ALTER TABLE liepin_data ADD COLUMN ai_decision TEXT;
ALTER TABLE liepin_data ADD COLUMN ai_reason TEXT;
ALTER TABLE liepin_data ADD COLUMN priority_company INTEGER DEFAULT 0;

ALTER TABLE job51_data ADD COLUMN ai_score INTEGER;
ALTER TABLE job51_data ADD COLUMN ai_decision TEXT;
ALTER TABLE job51_data ADD COLUMN ai_reason TEXT;
ALTER TABLE job51_data ADD COLUMN priority_company INTEGER DEFAULT 0;

ALTER TABLE delivery_attempt ADD COLUMN greeting_snapshot TEXT;

CREATE TABLE job_greeting_draft (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    job_key TEXT NOT NULL,
    content TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL,
    FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE CASCADE,
    UNIQUE(profile_id, platform, job_key)
);

CREATE INDEX idx_job_greeting_draft_profile_platform_job
    ON job_greeting_draft(profile_id, platform, job_key);
