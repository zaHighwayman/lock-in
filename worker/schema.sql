-- Generic record store: one row per app record, newest version only.
-- seq increases on every write, so clients pull "everything after my cursor".
CREATE TABLE IF NOT EXISTS records (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  tbl TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  data TEXT,
  UNIQUE (tbl, id)
);
CREATE INDEX IF NOT EXISTS records_seq ON records (seq);

-- OAuth tokens for Withings / Oura, AES-GCM encrypted with the TOKEN_KEY secret.
CREATE TABLE IF NOT EXISTS tokens (
  provider TEXT PRIMARY KEY,
  data TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);
