-- Allow payment orders without user_id (for pre-registration payments)
ALTER TABLE payment_orders ALTER COLUMN user_id DROP NOT NULL;

-- Add metadata column for storing registration data
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Add phone column for pre-registration tracking
ALTER TABLE payment_orders ADD COLUMN IF NOT EXISTS phone TEXT;
