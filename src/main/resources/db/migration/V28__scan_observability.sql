CREATE TABLE scan_run (
 platform TEXT NOT NULL, profile_id INTEGER NOT NULL, run_id TEXT NOT NULL,
 epoch INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'STARTING', desired TEXT NOT NULL DEFAULT 'RUNNING',
 stage TEXT NOT NULL DEFAULT 'registered', keyword TEXT NOT NULL DEFAULT '',
 extension_version TEXT NOT NULL DEFAULT '', content_version TEXT NOT NULL DEFAULT '',
 error_code TEXT NOT NULL DEFAULT '', stop_reason TEXT NOT NULL DEFAULT '',
 counters TEXT NOT NULL DEFAULT '{}', last_seq INTEGER NOT NULL DEFAULT 0,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, background_seen_at INTEGER, page_seen_at INTEGER,
 PRIMARY KEY(platform,profile_id,run_id)
);
CREATE TABLE scan_event (
 id INTEGER PRIMARY KEY AUTOINCREMENT, platform TEXT NOT NULL, profile_id INTEGER NOT NULL, run_id TEXT NOT NULL,
 event_id TEXT NOT NULL, epoch INTEGER NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL,
 payload TEXT NOT NULL, created_at INTEGER NOT NULL,
 UNIQUE(platform,profile_id,run_id,event_id)
);
CREATE INDEX scan_event_cursor ON scan_event(platform,profile_id,run_id,id);
CREATE TABLE scan_command (
 id TEXT PRIMARY KEY, platform TEXT NOT NULL, profile_id INTEGER NOT NULL, run_id TEXT NOT NULL,
 kind TEXT NOT NULL, epoch INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
 error_code TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX scan_command_run ON scan_command(platform,profile_id,run_id,created_at);
