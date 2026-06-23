-- Parental Control: child screen-time (app usage) + app blocking

-- Per-child, per-app, per-day foreground usage stats
CREATE TABLE IF NOT EXISTS app_usage (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  app_label VARCHAR(255),
  usage_date DATE NOT NULL,
  foreground_seconds INTEGER NOT NULL DEFAULT 0,
  opens INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, package_name, usage_date)
);

CREATE INDEX IF NOT EXISTS idx_app_usage_user_date ON app_usage(user_id, usage_date);

-- Apps a parent has blocked for a given child device
CREATE TABLE IF NOT EXISTS blocked_apps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  child_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_name VARCHAR(255) NOT NULL,
  app_label VARCHAR(255),
  blocked BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(child_user_id, package_name)
);

CREATE INDEX IF NOT EXISTS idx_blocked_apps_child ON blocked_apps(child_user_id);
