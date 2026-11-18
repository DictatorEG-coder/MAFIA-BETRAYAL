CREATE TABLE IF NOT EXISTS bot_users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  username TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_users_last_seen ON bot_users(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS bot_groups (
  chat_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  chat_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  added_at TEXT,
  last_seen_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_groups_last_seen ON bot_groups(last_seen_at DESC);
