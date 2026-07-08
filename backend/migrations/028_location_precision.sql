-- Real (non-cosmetic) location-precision preference, replacing the two
-- inconsistent local-only toggles in landing-react's ParentPanel.tsx/
-- ChildPanel.tsx (neither ever persisted or affected anything). Drives
-- actual GPS accuracy/update-interval on mobile (services/location.js,
-- MapScreen.jsx) via PATCH /api/v1/users/me.
ALTER TABLE users ADD COLUMN IF NOT EXISTS location_precision TEXT NOT NULL DEFAULT 'precise'
  CHECK (location_precision IN ('precise', 'fast'));
