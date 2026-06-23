-- Make password_hash and phone nullable.
-- Rationale:
--   * OTP-only and Google signups create users without a password. The app
--     stores a random hash for OTP signups, but Google signups have neither a
--     password nor a phone. The NOT NULL constraint on password_hash caused
--     POST /auth/register and /auth/google to fail with
--     "null value in column \"password_hash\" violates not-null constraint".
--   * phone is the login key for phone+password and OTP flows, but Google
--     accounts have no phone. UNIQUE allows multiple NULLs in PostgreSQL, so
--     dropping NOT NULL on phone does not break uniqueness for real numbers.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ALTER COLUMN phone DROP NOT NULL;
