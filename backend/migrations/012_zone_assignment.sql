-- Per-child safe-zone assignment + category
-- A zone with assigned_user_id = NULL applies to the whole circle (backward-compatible).
-- A zone with assigned_user_id set only triggers / shows for that specific member.

ALTER TABLE safe_zones
  ADD COLUMN IF NOT EXISTS assigned_user_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- category: home | school | tuition | playground | music | dance | other
ALTER TABLE safe_zones
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'other';

CREATE INDEX IF NOT EXISTS idx_safe_zones_assigned_user ON safe_zones(assigned_user_id);
