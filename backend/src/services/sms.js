/**
 * Pluggable SMS gateway.
 *
 * Config-driven: set env vars on the VPS to enable real SMS sending.
 * If neither provider is fully configured, sendSms() logs and no-ops
 * (returns { skipped: true }) — it never throws to the caller.
 *
 * ── Provider env vars (set one provider) ────────────────────────────────────
 *
 *   MSG91 (https://msg91.com — popular in India):
 *     MSG91_AUTH_KEY    (required)  your MSG91 auth key
 *     MSG91_SENDER      (required)  6-char sender/header ID, e.g. GRVTYP
 *     MSG91_ROUTE       (optional)  default "4" (transactional)
 *     MSG91_DLT_TE_ID   (optional)  DLT template id (required by Indian DLT)
 *
 *   Twilio (https://www.twilio.com):
 *     TWILIO_ACCOUNT_SID  (required)  starts with AC...
 *     TWILIO_AUTH_TOKEN   (required)  account auth token
 *     TWILIO_FROM         (required)  sending number in E.164, e.g. +14155552671
 *
 * MSG91 is preferred when both are set. Uses global fetch (Node 18+).
 */

function hasMsg91() {
  return Boolean(process.env.MSG91_AUTH_KEY && process.env.MSG91_SENDER)
}

function hasTwilio() {
  return Boolean(
    process.env.TWILIO_ACCOUNT_SID &&
    process.env.TWILIO_AUTH_TOKEN &&
    process.env.TWILIO_FROM
  )
}

/** True if any SMS provider is configured via env. */
function isSmsConfigured() {
  return hasMsg91() || hasTwilio()
}

/**
 * Normalize a phone number to an E.164-ish string: keep a single leading "+"
 * (if present) and digits only. Does not guess a country code.
 */
function normalizePhone(raw) {
  if (raw == null) return ''
  const s = String(raw).trim()
  const hasPlus = s.startsWith('+')
  const digits = s.replace(/\D/g, '')
  return (hasPlus ? '+' : '') + digits
}

async function sendViaMsg91(to, message) {
  const authKey = process.env.MSG91_AUTH_KEY
  const sender = process.env.MSG91_SENDER
  const route = process.env.MSG91_ROUTE || '4'
  // MSG91 expects numbers without a leading "+".
  const mobile = to.replace(/^\+/, '')

  const params = new URLSearchParams({
    authkey: authKey,
    mobiles: mobile,
    message,
    sender,
    route,
  })
  if (process.env.MSG91_DLT_TE_ID) {
    params.set('DLT_TE_ID', process.env.MSG91_DLT_TE_ID)
  }

  const resp = await fetch('https://api.msg91.com/api/sendhttp.php?' + params.toString(), {
    method: 'GET',
  })
  const body = await resp.text().catch(() => '')
  if (!resp.ok) {
    return { ok: false, provider: 'msg91', status: resp.status, body }
  }
  return { ok: true, provider: 'msg91', id: body }
}

async function sendViaTwilio(to, message) {
  const sid = process.env.TWILIO_ACCOUNT_SID
  const token = process.env.TWILIO_AUTH_TOKEN
  const from = process.env.TWILIO_FROM

  const url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`
  const auth = Buffer.from(`${sid}:${token}`).toString('base64')
  const params = new URLSearchParams({ To: to, From: from, Body: message })

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + auth,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    return { ok: false, provider: 'twilio', status: resp.status, body: data }
  }
  return { ok: true, provider: 'twilio', id: data.sid }
}

/**
 * Send an SMS. Best-effort: never throws.
 * @returns {Promise<object>} a small status object; { skipped:true } when no
 *   provider is configured, { ok:false, error } on failure.
 */
async function sendSms(to, message) {
  try {
    const phone = normalizePhone(to)
    if (!phone) {
      return { ok: false, error: 'no phone number' }
    }
    if (!isSmsConfigured()) {
      console.log(`[sms] (not configured) would send to ${phone}: ${message}`)
      return { skipped: true }
    }
    if (hasMsg91()) {
      return await sendViaMsg91(phone, message)
    }
    return await sendViaTwilio(phone, message)
  } catch (e) {
    console.error('[sms] send failed:', e && e.message ? e.message : e)
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
}

module.exports = { sendSms, isSmsConfigured, normalizePhone }
