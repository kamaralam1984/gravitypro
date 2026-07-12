-- 020_is_charging.sql
-- Track whether a device is currently charging, so the family map/circles can
-- show a ⚡ charging indicator instead of a plain battery icon.
-- Reported by the mobile app alongside battery_level (expo-battery getBatteryStateAsync).

ALTER TABLE device_locations
  ADD COLUMN IF NOT EXISTS is_charging boolean DEFAULT false;

ALTER TABLE user_latest_locations
  ADD COLUMN IF NOT EXISTS is_charging boolean DEFAULT false;
