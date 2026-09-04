ALTER TABLE boss_config
    ADD COLUMN native_greeting_disabled_confirmed INTEGER NOT NULL DEFAULT 0;

ALTER TABLE delivery_attempt
    ADD COLUMN greeting_source TEXT;

ALTER TABLE delivery_attempt
    ADD COLUMN greeting_outcome TEXT NOT NULL DEFAULT 'NOT_APPLICABLE';

ALTER TABLE delivery_attempt
    ADD COLUMN greeting_evidence TEXT;

UPDATE delivery_attempt
SET greeting_outcome = CASE
    WHEN platform = 'boss' AND state = 'REQUESTED' THEN 'PENDING'
    WHEN platform = 'boss' THEN 'UNKNOWN'
    ELSE 'NOT_APPLICABLE'
END;
