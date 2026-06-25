-- 016_checkins.sql — Check-In feature.
-- A member taps a preset ("I'm Home", "Reached School", ...) and every circle
-- member gets an instant SSE event + Expo push. Rows are kept so the circle can
-- see a recent check-in history (GET /checkins/circle/:circleId).

CREATE TABLE IF NOT EXISTS checkins (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  circle_id  uuid REFERENCES circles(id) ON DELETE CASCADE,
  type       text NOT NULL,
  message    text,
  lat        double precision,
  lng        double precision,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_checkins_circle_created
  ON checkins (circle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_checkins_user_created
  ON checkins (user_id, created_at DESC);
