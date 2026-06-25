-- 015_devices.sql
-- Hardware GPS tracker / smart-watch integration via Traccar.
-- Maps an external Traccar device (by its unique id) to a GravityPro user, so
-- positions forwarded from Traccar are ingested as that user's location and flow
-- through the exact same device_locations + geofence pipeline as the phone app.

CREATE TABLE IF NOT EXISTS tracker_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_uid text UNIQUE NOT NULL,   -- Traccar uniqueId / IMEI of the hardware device
  name text,
  type text DEFAULT 'gps',           -- 'gps' | 'watch' | etc.
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracker_devices_user ON tracker_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_tracker_devices_uid ON tracker_devices(device_uid);
