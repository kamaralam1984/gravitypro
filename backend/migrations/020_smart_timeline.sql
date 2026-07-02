-- Travel Timeline & AI Smart Places — strictly additive.
-- Numbered 020 to continue after this branch's existing 001-019 migrations
-- (012_zone_assignment.sql .. 019_zone_active_and_settings.sql).

-- 1) Reverse-geocode cache, keyed by geohash-7 (~150m x 150m cells).
CREATE TABLE IF NOT EXISTS geocode_cache (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  geohash7        TEXT NOT NULL UNIQUE,
  lat             NUMERIC NOT NULL,
  lng             NUMERIC NOT NULL,
  resolved_name   TEXT NOT NULL,
  resolved_type   TEXT NOT NULL DEFAULT 'unknown', -- poi|area|road|city|unknown
  category_hint   TEXT,                            -- raw OSM amenity/shop tag
  address_json    JSONB,
  raw_response    JSONB,
  provider        TEXT NOT NULL DEFAULT 'locationiq',
  hit_count       INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Persisted smart-timeline stops — incremental stop detection run inline
-- on every location ingest (see services/timelineStops.js). Trips (the
-- moving segments between stops) are deliberately NOT persisted — cheap to
-- derive on read from device_locations, avoids duplicating that data.
CREATE TABLE IF NOT EXISTS timeline_stops (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  center_geom       GEOMETRY(Point,4326) NOT NULL,
  arrived_at        TIMESTAMPTZ NOT NULL,
  departed_at       TIMESTAMPTZ,              -- NULL while the stop is "open"
  last_point_at     TIMESTAMPTZ NOT NULL,      -- for the stale-open-stop sweep
  point_count       INT NOT NULL DEFAULT 1,
  radius_m          NUMERIC NOT NULL DEFAULT 100,
  safe_zone_id      UUID REFERENCES safe_zones(id) ON DELETE SET NULL,
  safe_zone_name    TEXT,
  place_name        TEXT,                      -- final display name (never raw coords)
  place_type        TEXT,                      -- safe_zone|poi|area|road|city|unknown
  address           TEXT,
  category_hint     TEXT,                      -- OSM tag or safe_zones.category, for Smart Places
  geocode_cache_id  UUID REFERENCES geocode_cache(id),
  smart_place_id    UUID,                       -- FK added below, after smart_places exists
  photo_ids         JSONB,                     -- future photo/video timeline hook (unused this pass)
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timeline_stops_user_arrived ON timeline_stops(user_id, arrived_at DESC);
CREATE INDEX IF NOT EXISTS idx_timeline_stops_geom ON timeline_stops USING GIST(center_geom);
CREATE UNIQUE INDEX IF NOT EXISTS idx_timeline_stops_open_per_user
  ON timeline_stops(user_id) WHERE departed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_timeline_stops_user_unlinked
  ON timeline_stops(user_id) WHERE smart_place_id IS NULL AND departed_at IS NOT NULL;

-- 3) AI Smart Places — auto-detected frequently-visited locations, derived
-- entirely from timeline_stops (never a raw device_locations rescan).
CREATE TABLE IF NOT EXISTS smart_places (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id             UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  center_geom         GEOMETRY(Point,4326) NOT NULL,
  name                TEXT NOT NULL,
  place_type          TEXT NOT NULL DEFAULT 'unknown',
  category            TEXT NOT NULL DEFAULT 'unknown',
  category_hint       TEXT,
  safe_zone_id        UUID REFERENCES safe_zones(id) ON DELETE SET NULL,
  radius_m            NUMERIC NOT NULL DEFAULT 100,
  visit_count         INT NOT NULL DEFAULT 0,
  total_duration_sec  BIGINT NOT NULL DEFAULT 0,
  longest_stay_sec    BIGINT NOT NULL DEFAULT 0,
  avg_arrival_sec     INT,
  avg_departure_sec   INT,
  first_visit_at      TIMESTAMPTZ,
  last_visit_at       TIMESTAMPTZ,
  -- Future-ready hooks (Favorites/Pinned/Custom Icons/Photos) — unused this pass.
  is_favorite         BOOLEAN NOT NULL DEFAULT FALSE,
  is_pinned           BOOLEAN NOT NULL DEFAULT FALSE,
  custom_icon         TEXT,
  photo_ids           JSONB,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_smart_places_user ON smart_places(user_id);
CREATE INDEX IF NOT EXISTS idx_smart_places_geom ON smart_places USING GIST(center_geom);
CREATE INDEX IF NOT EXISTS idx_smart_places_user_visits ON smart_places(user_id, visit_count DESC);

DO $$ BEGIN
  ALTER TABLE timeline_stops ADD CONSTRAINT fk_timeline_stops_smart_place
    FOREIGN KEY (smart_place_id) REFERENCES smart_places(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_timeline_stops_smart_place ON timeline_stops(smart_place_id);

-- 4) Live map needs "current speed/heading" without scanning device_locations
-- on every poll — user_latest_locations already tracks the latest fix.
ALTER TABLE user_latest_locations ADD COLUMN IF NOT EXISTS speed NUMERIC;
ALTER TABLE user_latest_locations ADD COLUMN IF NOT EXISTS bearing NUMERIC;
