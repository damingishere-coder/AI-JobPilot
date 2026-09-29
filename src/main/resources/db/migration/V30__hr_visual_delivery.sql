ALTER TABLE hr_send_command ADD COLUMN transport TEXT NOT NULL DEFAULT 'CHROME_BRIDGE';

CREATE TABLE hr_visual_run (
    id TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profile(id),
    protocol TEXT NOT NULL,
    status TEXT NOT NULL,
    account_cipher TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hr_visual_target (
    id TEXT PRIMARY KEY,
    run_id TEXT NOT NULL REFERENCES hr_visual_run(id),
    conversation_id INTEGER NOT NULL REFERENCES hr_conversation(id),
    source_proposal_id INTEGER NOT NULL REFERENCES hr_reply_proposal(id),
    proposal_id INTEGER REFERENCES hr_reply_proposal(id),
    seed_cipher TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING_CAPTURE',
    reason TEXT NOT NULL DEFAULT '',
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(run_id, conversation_id)
);
CREATE INDEX idx_hr_visual_proposal ON hr_visual_target(proposal_id);
CREATE TABLE hr_send_step (
    id TEXT PRIMARY KEY,
    command_id TEXT NOT NULL REFERENCES hr_send_command(command_id),
    ordinal INTEGER NOT NULL,
    action_type TEXT NOT NULL CHECK(action_type IN ('TEXT','RESUME_NATIVE')),
    status TEXT NOT NULL DEFAULT 'PENDING',
    lease_hash TEXT,
    lease_expires_at INTEGER,
    submitted_at INTEGER,
    finished_at INTEGER,
    evidence_cipher TEXT,
    UNIQUE(command_id, ordinal)
);
CREATE INDEX idx_hr_send_step_state ON hr_send_step(status, finished_at);
