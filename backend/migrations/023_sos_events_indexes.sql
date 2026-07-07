-- 023: Give sos_events a real migration + indexes.
-- Unlike every other event table (geofence_events, checkins, chat_messages,
-- timeline_stops), sos_events only ever existed as an inline
-- "CREATE TABLE IF NOT EXISTS" duplicated in 3 route handlers, with no
-- indexes at all — despite GET /sos/history filtering by circle_id and
-- ordering by created_at, and GET /admin/sos ordering the whole table by
-- created_at. This migration is the schema of record going forward; the
-- duplicated inline CREATE TABLE statements in the route files are removed
-- in the same change.
CREATE TABLE IF NOT EXISTS sos_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  user_name TEXT,
  circle_id UUID,
  latitude FLOAT,
  longitude FLOAT,
  message TEXT,
  resolved BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sos_events_circle_created
  ON sos_events (circle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sos_events_created_at
  ON sos_events (created_at DESC);
