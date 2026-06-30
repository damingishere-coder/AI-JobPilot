CREATE TABLE IF NOT EXISTS profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    is_active INTEGER DEFAULT 0,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key TEXT,
    config_value TEXT,
    config_type TEXT,
    category TEXT,
    description TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS cookie (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    platform TEXT,
    cookie_value TEXT,
    remark TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS ai (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    introduce TEXT,
    prompt TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS resume_profile (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    resume_text TEXT,
    source_filename TEXT,
    parse_status TEXT,
    parse_message TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS priority_company (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    company_name TEXT NOT NULL,
    enabled INTEGER DEFAULT 1,
    remark TEXT,
    created_at DATETIME,
    updated_at DATETIME,
    UNIQUE(profile_id, company_name)
);

CREATE TABLE IF NOT EXISTS job_ai_analysis (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    platform TEXT,
    job_key TEXT,
    company_name TEXT,
    job_name TEXT,
    scan_run_id TEXT,
    score INTEGER,
    decision TEXT,
    summary TEXT,
    strengths TEXT,
    risks TEXT,
    greeting TEXT,
    priority_company INTEGER DEFAULT 0,
    raw_response TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS boss_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    debugger INTEGER DEFAULT 0,
    wait_time INTEGER DEFAULT 10,
    keywords VARCHAR(500),
    city_code VARCHAR(200),
    industry VARCHAR(200),
    job_type VARCHAR(50),
    experience VARCHAR(50),
    degree VARCHAR(200),
    salary VARCHAR(50),
    scale VARCHAR(200),
    stage VARCHAR(200),
    say_hi TEXT,
    expected_salary_min INTEGER,
    expected_salary_max INTEGER,
    enable_ai INTEGER DEFAULT 1,
    send_img_resume INTEGER DEFAULT 0,
    filter_dead_hr INTEGER DEFAULT 1,
    auto_deliver INTEGER DEFAULT 0,
    search_job_limit INTEGER DEFAULT 20,
    dead_status VARCHAR(200),
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS boss_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    encrypt_id TEXT,
    encrypt_user_id TEXT,
    company_name TEXT,
    job_name TEXT,
    salary TEXT,
    location TEXT,
    experience TEXT,
    degree TEXT,
    hr_name TEXT,
    hr_position TEXT,
    hr_active_status TEXT,
    delivery_status TEXT,
    failure_type TEXT,
    failure_reason TEXT,
    job_description TEXT,
    job_url TEXT,
    recruitment_status TEXT,
    company_address TEXT,
    industry TEXT,
    introduce TEXT,
    financing_stage TEXT,
    company_scale TEXT,
    scan_run_id TEXT,
    ai_score INTEGER,
    ai_decision TEXT,
    ai_reason TEXT,
    priority_company INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE IF NOT EXISTS boss_blacklist (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT,
    value TEXT,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS boss_option (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type VARCHAR(50),
    name VARCHAR(100),
    code VARCHAR(100),
    sort_order INTEGER,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS boss_industry (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    code INTEGER,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS zhilian_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    keywords VARCHAR(500),
    city_code VARCHAR(200),
    salary VARCHAR(50),
    search_job_limit INTEGER DEFAULT 20,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS zhilian_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    profile_id INTEGER,
    job_id VARCHAR(64),
    job_title VARCHAR(200),
    job_link VARCHAR(300),
    salary VARCHAR(100),
    location VARCHAR(100),
    experience VARCHAR(100),
    degree VARCHAR(100),
    company_name VARCHAR(200),
    delivery_status VARCHAR(20) DEFAULT '未投递',
    failure_type TEXT,
    failure_reason TEXT,
    job_description TEXT,
    scan_run_id TEXT,
    ai_score INTEGER,
    ai_decision TEXT,
    ai_reason TEXT,
    priority_company INTEGER DEFAULT 0,
    create_time DATETIME,
    update_time DATETIME
);

CREATE TABLE IF NOT EXISTS zhilian_option (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type VARCHAR(50),
    name VARCHAR(100),
    code VARCHAR(100),
    sort_order INTEGER,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS liepin_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keywords VARCHAR(500),
    city VARCHAR(100),
    salary_code VARCHAR(50),
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS liepin_option (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type VARCHAR(50),
    name VARCHAR(100),
    code VARCHAR(100),
    sort_order INTEGER,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS liepin_data (
    job_id BIGINT PRIMARY KEY,
    job_title VARCHAR(200),
    job_link VARCHAR(300),
    job_salary_text VARCHAR(100),
    job_area VARCHAR(100),
    job_edu_req VARCHAR(50),
    job_exp_req VARCHAR(50),
    job_publish_time VARCHAR(50),
    comp_id BIGINT,
    comp_name VARCHAR(200),
    comp_industry VARCHAR(100),
    comp_scale VARCHAR(50),
    hr_id VARCHAR(64),
    hr_name VARCHAR(50),
    hr_title VARCHAR(100),
    hr_im_id VARCHAR(64),
    delivered INTEGER DEFAULT 0,
    create_time DATETIME,
    update_time DATETIME
);

CREATE TABLE IF NOT EXISTS job51_config (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    keywords VARCHAR(500),
    job_area VARCHAR(100),
    salary VARCHAR(50),
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS job51_option (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type VARCHAR(50),
    name VARCHAR(100),
    code VARCHAR(100),
    sort_order INTEGER,
    created_at DATETIME,
    updated_at DATETIME
);

CREATE TABLE IF NOT EXISTS job51_data (
    job_id BIGINT PRIMARY KEY,
    job_title VARCHAR(200),
    job_link VARCHAR(300),
    job_salary_text VARCHAR(100),
    job_area VARCHAR(100),
    job_edu_req VARCHAR(50),
    job_exp_req VARCHAR(50),
    job_publish_time VARCHAR(50),
    comp_id BIGINT,
    comp_name VARCHAR(200),
    comp_industry VARCHAR(100),
    comp_scale VARCHAR(50),
    hr_id VARCHAR(64),
    hr_name VARCHAR(50),
    hr_title VARCHAR(100),
    delivered INTEGER DEFAULT 0,
    create_time TEXT,
    update_time TEXT
);
