CREATE TABLE resume_version (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    content_fingerprint TEXT NOT NULL,
    content_cipher TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_id, content_fingerprint)
);
CREATE TRIGGER resume_version_immutable BEFORE UPDATE ON resume_version
BEGIN SELECT RAISE(ABORT, 'resume_version is immutable'); END;
ALTER TABLE job_analysis_task ADD COLUMN context_key TEXT;
ALTER TABLE job_ai_analysis ADD COLUMN resume_version_id INTEGER;
ALTER TABLE job_ai_analysis ADD COLUMN analysis_context TEXT;
CREATE INDEX idx_job_analysis_context_dispatch ON job_analysis_task(profile_id,platform,context_key,status,id);
