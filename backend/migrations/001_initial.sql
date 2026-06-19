-- Trackalways Gravity - PostgreSQL + PostGIS Schema
-- Enable PostGIS extension
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) UNIQUE NOT NULL,
  name VARCHAR(100) NOT NULL,
  email VARCHAR(255) UNIQUE,
  avatar_url TEXT,
  push_token TEXT,
  country_code VARCHAR(5) NOT NULL DEFAULT 'IN',
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Circles (Family Groups)
CREATE TABLE IF NOT EXISTS circles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name VARCHAR(100) NOT NULL,
  icon_url TEXT,
  invite_code VARCHAR(12) UNIQUE NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Circle Members
CREATE TABLE IF NOT EXISTS circle_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(circle_id, user_id)
);

-- Device Locations (PostGIS geometry)
CREATE TABLE IF NOT EXISTS device_locations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  geom GEOMETRY(Point, 4326) NOT NULL,
  accuracy FLOAT,
  speed FLOAT,
  bearing FLOAT,
  altitude FLOAT,
  battery_level FLOAT,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast location queries
CREATE INDEX idx_device_locations_user_id ON device_locations(user_id);
CREATE INDEX idx_device_locations_geom ON device_locations USING GIST(geom);
CREATE INDEX idx_device_locations_recorded_at ON device_locations(recorded_at DESC);

-- Latest location per user (materialized view)
CREATE TABLE IF NOT EXISTS user_latest_locations (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  geom GEOMETRY(Point, 4326),
  accuracy FLOAT,
  battery_level FLOAT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Safe Zones (Geofences)
CREATE TABLE IF NOT EXISTS safe_zones (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  circle_id UUID NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  geom GEOMETRY(Polygon, 4326) NOT NULL,
  radius_meters FLOAT,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_safe_zones_circle_id ON safe_zones(circle_id);
CREATE INDEX idx_safe_zones_geom ON safe_zones USING GIST(geom);

-- Geofence Events
CREATE TABLE IF NOT EXISTS geofence_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  safe_zone_id UUID NOT NULL REFERENCES safe_zones(id) ON DELETE CASCADE,
  event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('entry', 'exit')),
  geom GEOMETRY(Point, 4326),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_geofence_events_user_id ON geofence_events(user_id);
CREATE INDEX idx_geofence_events_created_at ON geofence_events(created_at DESC);

-- Refresh trigger for updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_circles_updated_at BEFORE UPDATE ON circles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_safe_zones_updated_at BEFORE UPDATE ON safe_zones FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
