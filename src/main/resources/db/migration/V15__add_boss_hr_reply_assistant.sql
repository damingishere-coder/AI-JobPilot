-- V15 follows the BOSS greeting delivery audit introduced in V14.
CREATE TABLE hr_assistant_settings (
    profile_id INTEGER PRIMARY KEY,
    communication_profile_cipher TEXT,
    napcat_ws_url TEXT,
    napcat_token_cipher TEXT,
    qq_target_cipher TEXT,
    qq_enabled INTEGER NOT NULL DEFAULT 0,
    retention_days INTEGER NOT NULL DEFAULT 30,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE TABLE hr_conversation (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    platform TEXT NOT NULL DEFAULT 'boss',
    external_uid_hash TEXT NOT NULL,
    external_uid_cipher TEXT,
    hr_name_cipher TEXT,
    company_name_cipher TEXT,
    job_name_cipher TEXT,
    job_key TEXT,
    last_inbound_fingerprint TEXT,
    last_observed_at DATETIME,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE CASCADE,
    UNIQUE(profile_id, platform, external_uid_hash)
);

CREATE TABLE hr_message (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id INTEGER NOT NULL,
    fingerprint TEXT NOT NULL,
    direction TEXT NOT NULL,
    message_type TEXT NOT NULL,
    body_cipher TEXT NOT NULL,
    message_time TEXT,
    observed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    FOREIGN KEY(conversation_id) REFERENCES hr_conversation(id) ON DELETE CASCADE,
    UNIQUE(conversation_id, fingerprint)
);

CREATE TABLE hr_reply_proposal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER NOT NULL,
    conversation_id INTEGER NOT NULL,
    confirmation_code_hash TEXT NOT NULL,
    confirmation_code_cipher TEXT,
    source_fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    classification TEXT NOT NULL,
    draft_cipher TEXT,
    summary_cipher TEXT,
    risk_tags_cipher TEXT,
    missing_facts_cipher TEXT,
    confidence REAL NOT NULL DEFAULT 0,
    version INTEGER NOT NULL DEFAULT 1,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE CASCADE,
    FOREIGN KEY(conversation_id) REFERENCES hr_conversation(id) ON DELETE CASCADE
);

CREATE TABLE hr_reply_attempt (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    proposal_id INTEGER NOT NULL UNIQUE,
    request_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    evidence_cipher TEXT,
    approved_at DATETIME,
    attempted_at DATETIME,
    confirmed_at DATETIME,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(proposal_id) REFERENCES hr_reply_proposal(id) ON DELETE CASCADE
);

CREATE TABLE hr_qq_command (
    message_id TEXT PRIMARY KEY,
    sender_hash TEXT NOT NULL,
    command_type TEXT NOT NULL,
    received_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL
);

CREATE INDEX idx_hr_conversation_profile_updated
    ON hr_conversation(profile_id, updated_at DESC);
CREATE INDEX idx_hr_message_conversation_observed
    ON hr_message(conversation_id, observed_at DESC);
CREATE INDEX idx_hr_message_expiry
    ON hr_message(expires_at);
CREATE INDEX idx_hr_reply_proposal_profile_status
    ON hr_reply_proposal(profile_id, status, updated_at DESC);
CREATE INDEX idx_hr_reply_proposal_code
    ON hr_reply_proposal(profile_id, confirmation_code_hash, expires_at);
CREATE INDEX idx_hr_qq_command_expiry
    ON hr_qq_command(expires_at);
