-- 006_subscriptions.sql — Subscription plans, user subscriptions, payment orders

CREATE TABLE IF NOT EXISTS subscription_plans (
  id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  price_usd NUMERIC(10,2) DEFAULT 0,
  price_inr NUMERIC(10,2) DEFAULT 0,
  price_kes NUMERIC(10,2) DEFAULT 0,
  price_eur NUMERIC(10,2) DEFAULT 0,
  price_gbp NUMERIC(10,2) DEFAULT 0,
  max_members INT NOT NULL DEFAULT 2,
  max_circles INT NOT NULL DEFAULT 1,
  history_days INT NOT NULL DEFAULT 1,
  features JSONB DEFAULT '[]',
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'free',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','cancelled','expired','pending')),
  gateway TEXT NOT NULL DEFAULT 'free',
  gateway_subscription_id TEXT,
  gateway_customer_id TEXT,
  current_period_start TIMESTAMPTZ DEFAULT NOW(),
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL DEFAULT 'free',
  gateway TEXT NOT NULL,
  gateway_order_id TEXT,
  gateway_payment_id TEXT,
  amount NUMERIC(12,2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','failed','cancelled')),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user ON payment_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_payment_orders_gateway ON payment_orders(gateway_order_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON user_subscriptions(user_id);

ALTER TABLE users ADD COLUMN IF NOT EXISTS current_plan TEXT DEFAULT 'free';

INSERT INTO subscription_plans (id, display_name, price_usd, price_inr, price_kes, price_eur, price_gbp, max_members, max_circles, history_days, features)
VALUES
  ('free','Free Forever',0,0,0,0,0,4,1,1,'["Live location sharing","Family Circle (up to 4 members)","1 Safe Zone","SOS Panic Button","24-hour location history"]'),
  ('family','Family',5.99,299,599,5.49,4.99,6,3,7,'["Everything in Free","Up to 6 members","3 Safe Zones","7-day history","Battery level reports","Journey tracking"]'),
  ('premium','Premium',9.99,499,999,8.99,7.99,15,10,30,'["Everything in Family","Up to 15 members","Unlimited Safe Zones","30-day history","Priority support 24/7","Auto emergency alerts"]')
ON CONFLICT (id) DO UPDATE SET
  price_usd=EXCLUDED.price_usd, price_inr=EXCLUDED.price_inr,
  price_kes=EXCLUDED.price_kes, price_eur=EXCLUDED.price_eur,
  price_gbp=EXCLUDED.price_gbp, features=EXCLUDED.features;
