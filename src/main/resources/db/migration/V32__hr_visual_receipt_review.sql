CREATE TABLE hr_visual_receipt_review (
    step_id TEXT PRIMARY KEY REFERENCES hr_send_step(id),
    previous_status TEXT NOT NULL,
    original_evidence_cipher TEXT,
    reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
