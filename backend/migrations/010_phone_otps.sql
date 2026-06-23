-- phone_otps — SMS phone OTP storage. The code (src/routes/auth.js: send-otp,
-- verify-otp, register) reads/writes this table, but no migration created it
-- (only email_otps existed). Mirrors email_otps. This fixes that gap.
CREATE TABLE IF NOT EXISTS phone_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone VARCHAR(20) NOT NULL,
  code VARCHAR(6) NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_phone_otps_lookup
  ON phone_otps (phone, code, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_phone_otps_phone_created
  ON phone_otps (phone, created_at);
