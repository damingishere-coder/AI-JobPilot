-- Retry analysis only. Browser send leases and unknown outcomes are unchanged.
ALTER TABLE hr_background_capture ADD COLUMN retry_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_background_capture ADD COLUMN retry_at INTEGER NOT NULL DEFAULT 0;
CREATE INDEX hr_background_capture_retry ON hr_background_capture(profile_id,account_hash,status,retry_at);
