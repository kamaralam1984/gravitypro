-- 022: Composite index for the geofence status hot-path lookup
-- checkGeofenceStatus() (services/geofence.js) runs on every GPS location
-- update and, per applicable safe zone, looks up that zone's most recent
-- entry/exit event for the user. Without an index covering
-- (user_id, safe_zone_id, created_at), that query can only use the plain
-- user_id index and must filter+sort every event that user has ever
-- generated, across all their zones, on every single location ping.
CREATE INDEX IF NOT EXISTS idx_geofence_events_user_zone_created
  ON geofence_events (user_id, safe_zone_id, created_at DESC);
