-- Data fix: registration leaves users.account_type at its 'parent' default
-- unless the user explicitly picks "Child" on signup, and joining a circle
-- via invite code never corrected it (fixed going forward in
-- routes/circles.js POST /join). Retroactively correct existing accounts
-- that are stuck mislabeled "Parent": a user who is a plain 'member' of at
-- least one circle and has never created/administered a circle of their own
-- is, in this app's real usage, a child who joined via a parent's invite code.
-- Naturally idempotent: already-corrected rows no longer match account_type='parent'.
UPDATE users SET account_type = 'child'
WHERE account_type = 'parent'
  AND id IN (SELECT user_id FROM circle_members WHERE role = 'member')
  AND id NOT IN (SELECT user_id FROM circle_members WHERE role = 'admin');
