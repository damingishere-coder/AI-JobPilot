-- Additive only. Keep this column when rolling back application binaries.
ALTER TABLE zhilian_config ADD COLUMN filters_json TEXT NOT NULL DEFAULT '{}';
