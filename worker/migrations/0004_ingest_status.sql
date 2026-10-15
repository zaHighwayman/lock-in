-- Last attempt from the user's iPhone Shortcut, so the app can show what arrived (field names only, no values).
ALTER TABLE users ADD COLUMN last_ingest_at INTEGER;
ALTER TABLE users ADD COLUMN last_ingest_info TEXT;
