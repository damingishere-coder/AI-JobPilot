CREATE TABLE fresh_scan_receipt (
    profile_id INTEGER NOT NULL,
    platform TEXT NOT NULL,
    scan_run_id TEXT NOT NULL,
    job_key TEXT NOT NULL,
    keyword TEXT NOT NULL,
    eligible INTEGER NOT NULL,
    accepted INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(profile_id, platform, scan_run_id, job_key)
);
