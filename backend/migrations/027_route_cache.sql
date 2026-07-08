-- OSRM route cache, keyed by geohash-8 pair (~19m x 19m cells) for origin and
-- destination. Mirrors geocode_cache's shape/conventions (020_smart_timeline.sql)
-- so backend/src/services/routing.js follows the same cache-table pattern as
-- backend/src/services/geocoding.js.

CREATE TABLE IF NOT EXISTS route_cache (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  origin_geohash8 TEXT NOT NULL,
  dest_geohash8   TEXT NOT NULL,
  origin_lat      NUMERIC NOT NULL,
  origin_lng      NUMERIC NOT NULL,
  dest_lat        NUMERIC NOT NULL,
  dest_lng        NUMERIC NOT NULL,
  geometry_json   JSONB NOT NULL,           -- [[lat,lng], ...] snapped coordinates
  distance_meters NUMERIC NOT NULL,
  duration_sec    NUMERIC NOT NULL,
  provider        TEXT NOT NULL DEFAULT 'osrm',
  hit_count       INT NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_route_cache_pair ON route_cache(origin_geohash8, dest_geohash8);
