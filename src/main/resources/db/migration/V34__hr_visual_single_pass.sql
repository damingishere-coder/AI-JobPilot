ALTER TABLE hr_visual_run ADD COLUMN open_reserved INTEGER NOT NULL DEFAULT 1;
CREATE TABLE hr_visual_batch (
    id TEXT PRIMARY KEY,
    profile_id INTEGER NOT NULL REFERENCES profile(id),
    request_key TEXT NOT NULL,
    request_hash TEXT NOT NULL,
    protocol TEXT NOT NULL,
    account_cipher TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'STARTING',
    stage TEXT NOT NULL DEFAULT 'BOOTSTRAP',
    after_anchors TEXT NOT NULL DEFAULT 'DISCOVER',
    open_reserved INTEGER NOT NULL DEFAULT 0,
    cursor_cipher TEXT,
    coverage_complete INTEGER NOT NULL DEFAULT 0,
    coverage_gap INTEGER NOT NULL DEFAULT 0,
    stalled_pages INTEGER NOT NULL DEFAULT 0,
    page_count INTEGER NOT NULL DEFAULT 0,
    pass_no INTEGER NOT NULL DEFAULT 1,
    first_pass_cipher TEXT,
    current_pass_cipher TEXT,
    reason TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    UNIQUE(profile_id,request_key)
);
CREATE TABLE hr_visual_batch_item (
    id TEXT PRIMARY KEY,
    batch_id TEXT NOT NULL REFERENCES hr_visual_batch(id),
    identity_hash TEXT NOT NULL,
    contact_cipher TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'CONTACT',
    status TEXT NOT NULL DEFAULT 'PENDING',
    conversation_id INTEGER REFERENCES hr_conversation(id),
    run_id TEXT UNIQUE REFERENCES hr_visual_run(id),
    request_cipher TEXT,
    observed_at INTEGER,
    reason TEXT NOT NULL DEFAULT '',
    UNIQUE(batch_id,kind,identity_hash)
);
CREATE TABLE hr_visual_observation (
    profile_id INTEGER PRIMARY KEY REFERENCES profile(id),
    current_cipher TEXT NOT NULL,
    last_success_cipher TEXT,
    updated_at INTEGER NOT NULL
);
