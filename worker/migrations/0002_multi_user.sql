-- Multi-user: accounts, sessions, invites; records and tokens become per-user.
-- Existing rows get user_id '' and are claimed by the first (admin) account.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_seen INTEGER,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);

CREATE TABLE IF NOT EXISTS invites (
  code TEXT PRIMARY KEY,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_by TEXT,
  used_at INTEGER
);

CREATE TABLE records_v2 (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL DEFAULT '',
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  UNIQUE (user_id, tbl, id)
);
INSERT INTO records_v2 (user_id, tbl, id, updated_at, deleted, data)
  SELECT '', tbl, id, updated_at, deleted, data FROM records ORDER BY seq;
DROP TABLE records;
ALTER TABLE records_v2 RENAME TO records;
CREATE INDEX records_user_seq ON records (user_id, seq);

CREATE TABLE tokens_v2 (
  user_id TEXT NOT NULL DEFAULT '',
  provider TEXT NOT NULL,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, provider)
);
INSERT INTO tokens_v2 (user_id, provider, data, updated_at)
  SELECT '', provider, data, updated_at FROM tokens;
DROP TABLE tokens;
ALTER TABLE tokens_v2 RENAME TO tokens;
