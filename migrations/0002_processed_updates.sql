CREATE TABLE IF NOT EXISTS processed_updates (
  update_id INTEGER PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'processing',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_processed_updates_created ON processed_updates(created_at);
