-- 013_profiles_contacts.sql
-- (a) Parent-created child profiles: add date-of-birth + "who created this account".
-- (b) Emergency contacts list (notified on SOS in addition to circle members).

-- ── Child profile fields on users ──────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS dob date;
ALTER TABLE users ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES users(id);

-- ── Emergency contacts ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  relation text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_emergency_contacts_owner ON emergency_contacts(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_users_created_by ON users(created_by);
