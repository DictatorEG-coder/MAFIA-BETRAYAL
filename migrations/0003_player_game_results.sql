CREATE TABLE IF NOT EXISTS player_game_results (
  game_id TEXT NOT NULL,
  telegram_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  faction TEXT NOT NULL,
  alive INTEGER NOT NULL DEFAULT 0,
  winner TEXT,
  played_at TEXT NOT NULL,
  PRIMARY KEY (game_id, telegram_id)
);
CREATE INDEX IF NOT EXISTS idx_player_game_results_player ON player_game_results(telegram_id, played_at DESC);
