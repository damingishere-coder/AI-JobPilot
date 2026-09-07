ALTER TABLE hr_message ADD COLUMN metadata_cipher TEXT;
CREATE TABLE hr_autopilot_policy (
 profile_id INTEGER PRIMARY KEY REFERENCES profile(id) ON DELETE CASCADE,
 version INTEGER NOT NULL DEFAULT 1,
 enabled INTEGER NOT NULL DEFAULT 0,
 paused INTEGER NOT NULL DEFAULT 0,
 policy_cipher TEXT NOT NULL,
 settings_hash TEXT,
 enabled_at TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hr_autopilot_context (
 conversation_id INTEGER PRIMARY KEY REFERENCES hr_conversation(id) ON DELETE CASCADE,
 snapshot_cipher TEXT NOT NULL,
 facts_cipher TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hr_autopilot_decision (
 proposal_id INTEGER PRIMARY KEY REFERENCES hr_reply_proposal(id) ON DELETE CASCADE,
 policy_version INTEGER NOT NULL,
 action_type TEXT NOT NULL,
 reason_cipher TEXT NOT NULL,
 automatic INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE hr_qq_delivery (
 id TEXT PRIMARY KEY,
 profile_id INTEGER NOT NULL REFERENCES profile(id) ON DELETE CASCADE,
 dedupe_key TEXT NOT NULL UNIQUE,
 payload_cipher TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING',
 message_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_hr_qq_delivery_pending ON hr_qq_delivery(status, created_at);
