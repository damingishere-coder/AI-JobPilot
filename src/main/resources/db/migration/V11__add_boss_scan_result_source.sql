ALTER TABLE boss_data
    ADD COLUMN scan_result_source TEXT NOT NULL DEFAULT 'CURRENT_SCAN'
        CHECK (scan_result_source IN ('CURRENT_SCAN', 'HISTORICAL_REUSED'));

UPDATE boss_data
SET scan_result_source = 'CURRENT_SCAN'
WHERE scan_result_source IS NULL OR TRIM(scan_result_source) = '';

CREATE INDEX IF NOT EXISTS idx_boss_data_profile_run_source
    ON boss_data(profile_id, scan_run_id, scan_result_source);
