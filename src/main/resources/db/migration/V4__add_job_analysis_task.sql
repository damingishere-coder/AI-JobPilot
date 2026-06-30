CREATE TABLE IF NOT EXISTS job_analysis_task (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    platform TEXT NOT NULL,
    scan_run_id TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    total_count INTEGER DEFAULT 0,
    processed_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    message TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE INDEX IF NOT EXISTS idx_job_analysis_task_profile_platform_status
    ON job_analysis_task(profile_id, platform, status);

CREATE INDEX IF NOT EXISTS idx_job_analysis_task_scan_run
    ON job_analysis_task(scan_run_id);
