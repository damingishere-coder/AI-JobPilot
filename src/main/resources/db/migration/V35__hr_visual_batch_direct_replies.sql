ALTER TABLE hr_visual_batch ADD COLUMN reply_mode TEXT NOT NULL DEFAULT 'REVIEW' CHECK(reply_mode IN ('REVIEW','AUTO'));
ALTER TABLE hr_visual_batch ADD COLUMN text_authorization_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE hr_visual_batch ADD COLUMN text_authorized_at INTEGER;
ALTER TABLE hr_visual_batch ADD COLUMN process_discovered INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_visual_batch_item ADD COLUMN auto_reviewed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE hr_visual_batch_item ADD COLUMN text_facts_hash TEXT NOT NULL DEFAULT '';
