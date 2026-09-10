ALTER TABLE hr_assistant_settings
    ADD COLUMN qq_target_type TEXT NOT NULL DEFAULT 'PRIVATE';

ALTER TABLE hr_assistant_settings
    ADD COLUMN qq_operator_cipher TEXT;
