CREATE TABLE hr_scan_capture (
    watch_session_id TEXT NOT NULL,
    capture_id TEXT NOT NULL,
    profile_id INTEGER NOT NULL,
    scan_id TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(watch_session_id, capture_id),
    FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE TABLE hr_send_command (
    command_id TEXT PRIMARY KEY,
    proposal_id INTEGER NOT NULL UNIQUE,
    profile_id INTEGER NOT NULL,
    watch_session_id TEXT NOT NULL,
    status TEXT NOT NULL,
    lease_token_hash TEXT,
    lease_expires_at DATETIME,
    expires_at DATETIME NOT NULL,
    outcome TEXT,
    evidence_cipher TEXT,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(proposal_id) REFERENCES hr_reply_proposal(id) ON DELETE CASCADE,
    FOREIGN KEY(profile_id) REFERENCES profile(id) ON DELETE CASCADE
);

CREATE INDEX idx_hr_scan_capture_status
    ON hr_scan_capture(profile_id, status, updated_at);
CREATE INDEX idx_hr_send_command_claim
    ON hr_send_command(profile_id, watch_session_id, status, expires_at);
CREATE INDEX idx_hr_send_command_lease
    ON hr_send_command(status, lease_expires_at);
