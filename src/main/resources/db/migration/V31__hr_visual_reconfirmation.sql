CREATE TABLE hr_visual_reconfirmation (
    old_proposal_id INTEGER PRIMARY KEY REFERENCES hr_reply_proposal(id),
    new_proposal_id INTEGER NOT NULL UNIQUE REFERENCES hr_reply_proposal(id),
    target_id TEXT NOT NULL REFERENCES hr_visual_target(id),
    reason TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
