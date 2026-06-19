ALTER TABLE users
  ADD COLUMN IF NOT EXISTS account_type VARCHAR(10) NOT NULL DEFAULT 'parent'
    CHECK (account_type IN ('parent', 'child'));
