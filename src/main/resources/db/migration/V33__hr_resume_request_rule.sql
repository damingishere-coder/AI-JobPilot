CREATE TABLE hr_resume_rule (
    profile_id INTEGER PRIMARY KEY REFERENCES profile(id),
    enabled INTEGER NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    account_cipher TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'STOPPED',
    reason TEXT NOT NULL DEFAULT '',
    last_scan INTEGER NOT NULL DEFAULT 0,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hr_resume_contact_scan (
    profile_id INTEGER NOT NULL REFERENCES profile(id),
    identity_hash TEXT NOT NULL,
    contact_cipher TEXT NOT NULL,
    preview_hash TEXT NOT NULL,
    checked_preview_hash TEXT,
    seen_at INTEGER NOT NULL,
    PRIMARY KEY(profile_id,identity_hash)
);
CREATE TABLE hr_resume_rule_attempt (
    profile_id INTEGER NOT NULL REFERENCES profile(id),
    conversation_id INTEGER NOT NULL REFERENCES hr_conversation(id),
    request_hash TEXT NOT NULL,
    rule_version INTEGER NOT NULL,
    run_id TEXT NOT NULL UNIQUE REFERENCES hr_visual_run(id),
    request_cipher TEXT NOT NULL,
    PRIMARY KEY(profile_id,conversation_id,request_hash)
);
