-- 019: Safe-zone on/off toggle + per-user privacy/notification settings + speeding threshold
-- Backs: (a) parent can disable a safe zone without deleting it,
--        (b) child "Share my location" + notification preferences (now persisted/enforced),
--        (c) per-user speeding alert threshold.

-- (a) Safe zones: an "active=false" zone is kept but ignored by geofence checks.
ALTER TABLE safe_zones ADD COLUMN IF NOT EXISTS active BOOLEAN NOT NULL DEFAULT TRUE;

-- (b) User privacy + notification preferences (sane safety-first defaults: everything ON).
ALTER TABLE users ADD COLUMN IF NOT EXISTS share_location  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_arrivals  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_sos       BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS notif_geofence  BOOLEAN NOT NULL DEFAULT TRUE;

-- (c) Speeding alert threshold in km/h (0 = disabled). 80 km/h default.
ALTER TABLE users ADD COLUMN IF NOT EXISTS speed_alert_kmh INTEGER NOT NULL DEFAULT 80;

-- Hysteresis flag so a speeding alert isn't re-sent every GPS fix while over the limit.
ALTER TABLE device_status ADD COLUMN IF NOT EXISTS speeding_alerted BOOLEAN NOT NULL DEFAULT FALSE;
