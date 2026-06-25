-- 017_share_links.sql
-- Temporary public "Share Live Location" links.
-- A row maps a random url-safe token to a user, with a hard expiry (30 min by default).
-- Anyone holding an unexpired token can read the user's latest location with no auth.

CREATE TABLE IF NOT EXISTS share_links (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL
);

-- Lookups are by token (PK) for reads; this index speeds owner-scoped queries
-- and lets a cleanup job prune expired rows efficiently.
CREATE INDEX IF NOT EXISTS idx_share_links_user    ON share_links(user_id);
CREATE INDEX IF NOT EXISTS idx_share_links_expires ON share_links(expires_at);
