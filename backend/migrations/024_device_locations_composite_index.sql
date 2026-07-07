-- 024: Composite index for per-user, date-ranged Timeline/Reports queries.
-- Only single-column indexes existed on device_locations (user_id;
-- recorded_at DESC; geom GIST). computeDay() and GET /timeline/:userId/days
-- both filter by user_id AND a recorded_at range — a composite index lets
-- Postgres satisfy both the equality and range predicate from a single
-- index scan instead of scanning that user's entire location history.
CREATE INDEX IF NOT EXISTS idx_device_locations_user_recorded
  ON device_locations (user_id, recorded_at DESC);
