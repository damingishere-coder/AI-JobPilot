CREATE UNIQUE INDEX IF NOT EXISTS idx_priority_company_profile_name
    ON priority_company(profile_id, company_name);

CREATE INDEX IF NOT EXISTS idx_boss_blacklist_type_value
    ON boss_blacklist(type, value);

CREATE INDEX IF NOT EXISTS idx_boss_option_type_code
    ON boss_option(type, code);

CREATE INDEX IF NOT EXISTS idx_boss_industry_code
    ON boss_industry(code);

CREATE INDEX IF NOT EXISTS idx_boss_data_profile_run_encrypt
    ON boss_data(profile_id, scan_run_id, encrypt_id);

CREATE INDEX IF NOT EXISTS idx_boss_data_profile_delivery_status
    ON boss_data(profile_id, delivery_status);

CREATE INDEX IF NOT EXISTS idx_boss_data_profile_created_at
    ON boss_data(profile_id, created_at);

CREATE INDEX IF NOT EXISTS idx_boss_data_profile_company_job
    ON boss_data(profile_id, company_name, job_name);

CREATE INDEX IF NOT EXISTS idx_job_ai_analysis_profile_platform_job_run
    ON job_ai_analysis(profile_id, platform, job_key, scan_run_id);

CREATE INDEX IF NOT EXISTS idx_zhilian_data_profile_scan_run
    ON zhilian_data(profile_id, scan_run_id);

CREATE INDEX IF NOT EXISTS idx_liepin_data_company_job
    ON liepin_data(comp_name, job_title);

CREATE INDEX IF NOT EXISTS idx_job51_data_company_job
    ON job51_data(comp_name, job_title);
