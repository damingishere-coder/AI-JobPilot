ALTER TABLE hr_autopilot_policy ADD COLUMN contract_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_autopilot_decision ADD COLUMN evidence_cipher TEXT;
ALTER TABLE hr_autopilot_decision ADD COLUMN capture_origin TEXT NOT NULL DEFAULT 'LIVE';
CREATE TABLE hr_duty_progress (
 profile_id INTEGER PRIMARY KEY REFERENCES profile(id) ON DELETE CASCADE,
 processed INTEGER NOT NULL DEFAULT 0,
 baseline_complete INTEGER NOT NULL DEFAULT 0,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
