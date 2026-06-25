-- 018_chat_messages.sql
-- Family chat: text / image / location / voice messages per circle.

CREATE TABLE IF NOT EXISTS chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  circle_id uuid NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'text',
  text text,
  media_url text,
  lat double precision,
  lng double precision,
  duration_sec integer,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_circle_created
  ON chat_messages (circle_id, created_at);
