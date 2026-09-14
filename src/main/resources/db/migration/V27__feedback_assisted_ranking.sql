ALTER TABLE ai ADD COLUMN preference_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE ai ADD COLUMN preference_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE ai ADD COLUMN ranking_enabled INTEGER NOT NULL DEFAULT 0 CHECK(ranking_enabled IN(0,1));
ALTER TABLE job_ai_analysis ADD COLUMN evaluated_result_cipher TEXT;

-- Existing composite scores and confirmed batches remain unchanged; no re-analysis/backfill.
