-- 014_device_status.sql
-- Per-user device health tracking for BATTERY-LOW, DEVICE-OFFLINE and GPS-OFF alerts.
-- One row per user, upserted on every accepted location update (see routes/locations.js)
-- and on GPS status changes (see routes/deviceStatus.js). Scanned periodically by
-- services/deviceMonitor.js to emit DEVICE-OFFLINE alerts.

CREATE TABLE IF NOT EXISTS device_status (
  user_id              uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_location_at     timestamptz,
  last_battery         int,
  battery_low_alerted  boolean DEFAULT false,
  offline_alerted      boolean DEFAULT false,
  gps_enabled          boolean DEFAULT true,
  updated_at           timestamptz DEFAULT now()
);

-- Index to speed up the deviceMonitor offline scan.
CREATE INDEX IF NOT EXISTS idx_device_status_offline_scan
  ON device_status (last_location_at)
  WHERE offline_alerted = false;
