-- 025: Track real SMS delivery outcome separately from OTP verification.
-- phone_otps.used means the code was successfully verified/consumed at
-- login — it says nothing about whether the SMS provider actually
-- delivered it. The admin OTP Logs "SMS Debug" stats were computing
-- "Delivered"/"Failed" from `used`, mislabeling normal user drop-off
-- (never entered the code) as SMS delivery failure. sms_sent is NULL for
-- historical rows (delivery outcome unknown) and TRUE/FALSE going forward,
-- populated from the same smsSent value already computed in
-- POST /auth/send-otp but never persisted before now.
ALTER TABLE phone_otps ADD COLUMN IF NOT EXISTS sms_sent BOOLEAN;
