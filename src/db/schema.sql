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
  group_id TEXT,
  FOREIGN KEY (retro_id) REFERENCES retros(id) ON DELETE CASCADE,
  FOREIGN KEY (group_id) REFERENCES item_groups(id) ON DELETE SET NULL
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

-- Item groups table (for merging similar items)
CREATE TABLE IF NOT EXISTS item_groups (
  id TEXT PRIMARY KEY,
  retro_id TEXT NOT NULL,
  column_type TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (retro_id) REFERENCES retros(id) ON DELETE CASCADE
);

-- Group votes table (for voting on groups as a whole)
CREATE TABLE IF NOT EXISTS group_votes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES item_groups(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_items_retro ON items(retro_id);
CREATE INDEX IF NOT EXISTS idx_items_group ON items(group_id);
CREATE INDEX IF NOT EXISTS idx_votes_item ON votes(item_id);
CREATE INDEX IF NOT EXISTS idx_votes_participant ON votes(participant_id);
CREATE INDEX IF NOT EXISTS idx_item_groups_retro ON item_groups(retro_id);
CREATE INDEX IF NOT EXISTS idx_group_votes_group ON group_votes(group_id);
CREATE INDEX IF NOT EXISTS idx_group_votes_participant ON group_votes(participant_id);
