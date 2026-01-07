-- Retros table
CREATE TABLE IF NOT EXISTS retros (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT 'Untitled Retro',
  created_at INTEGER NOT NULL,
  facilitator_id TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'waiting'
);

-- Items table (Start/Stop/Continue cards)
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL,
  column_type TEXT NOT NULL,
  text TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (retro_id) REFERENCES retros(id) ON DELETE CASCADE
);

-- Votes table
CREATE TABLE IF NOT EXISTS votes (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
  UNIQUE(item_id, participant_id, id)
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_items_retro ON items(retro_id);
CREATE INDEX IF NOT EXISTS idx_votes_item ON votes(item_id);
CREATE INDEX IF NOT EXISTS idx_votes_participant ON votes(participant_id);
