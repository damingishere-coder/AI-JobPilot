CREATE TABLE hr_background_capture (
    id TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profile(id),
    capture_key TEXT NOT NULL,
    payload_hash TEXT NOT NULL,
    payload_cipher TEXT NOT NULL,
    account_hash TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','PROCESSING','DONE','BLOCKED')),
    error_code TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(profile_id,capture_key)
);
CREATE INDEX hr_background_capture_pending ON hr_background_capture(profile_id,account_hash,status,created_at);

CREATE TABLE hr_chrome_conversation_alias (
    profile_id INTEGER NOT NULL REFERENCES profile(id),
    chrome_uid_hash TEXT NOT NULL,
    chrome_uid_cipher TEXT NOT NULL,
    conversation_id INTEGER NOT NULL REFERENCES hr_conversation(id),
    identity_hash TEXT NOT NULL,
    source_round_hash TEXT NOT NULL,
    legacy_source_fingerprint TEXT NOT NULL,
    evidence_cipher TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id,chrome_uid_hash),
    UNIQUE(profile_id,conversation_id)
);

ALTER TABLE hr_send_command ADD COLUMN dispatch_at DATETIME;
ALTER TABLE hr_send_command ADD COLUMN before_capture_cipher TEXT;
ALTER TABLE hr_send_command ADD COLUMN original_lease_token_hash TEXT;
