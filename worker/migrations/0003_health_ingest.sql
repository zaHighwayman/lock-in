-- Personal key for the iPhone Shortcut that sends Apple Health data (hash only; the key is shown once).
ALTER TABLE users ADD COLUMN ingest_hash TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS users_ingest ON users (ingest_hash);
