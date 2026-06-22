-- Email OTP support — mirrors phone_otps, used for email verification at signup
-- and for email-based OTP login.
CREATE TABLE IF NOT EXISTS email_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  used BOOLEAN NOT NULL DEFAULT FALSE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otps_lookup
  ON email_otps (email, code, used, expires_at);

CREATE INDEX IF NOT EXISTS idx_email_otps_email_created
  ON email_otps (email, created_at);
