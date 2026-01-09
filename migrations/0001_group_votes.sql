-- Group votes table (for voting on groups as a whole)
CREATE TABLE IF NOT EXISTS group_votes (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (group_id) REFERENCES item_groups(id) ON DELETE CASCADE
);

-- Index for faster lookups
CREATE INDEX IF NOT EXISTS idx_group_votes_group ON group_votes(group_id);
CREATE INDEX IF NOT EXISTS idx_group_votes_participant ON group_votes(participant_id);
