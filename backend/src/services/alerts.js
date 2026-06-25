// alerts.js — shared alert delivery helper.
//
// Mirrors the EXACT delivery used by services/geofence.js (which keeps its own
// inline copy and is intentionally left untouched):
//   1. SSE broadcast to every member of each circle the subject belongs to,
//      via sse.sendToCircleMembers(circleId, eventName, data).
//   2. Expo push notification to those members' push_token (excluding the
//      subject themselves), via the same exp.host endpoint geofence.js uses.
//
// New device-health alert types (battery_low, device_offline, gps_off) are
// delivered through this helper so they land in the same Alerts feed plumbing.

const { query } = require('../config/db')
const { sendToCircleMembers } = require('./sse')

// Same Expo push call as geofence.sendPushNotifications.
const sendPushNotifications = async (tokens, message) => {
  if (!process.env.EXPO_ACCESS_TOKEN) return
  if (!tokens || !tokens.length) return
  const messages = tokens.map(token => ({
    to: token,
    sound: 'default',
    title: message.title,
    body: message.body,
    data: message.data,
  }))
  try {
    await fetch('https://exp.host/--/api/v2/push/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.EXPO_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(messages),
    })
  } catch (err) {
    console.error('[alerts] push error:', err.message)
  }
}

/**
 * Send a device-health alert about `subjectUserId` to every circle they belong
 * to. Delivered via SSE (event name = `eventName`) + Expo push, identical to the
 * geofence/sos delivery so it appears in the existing Alerts feed.
 *
 * @param {string} subjectUserId  user the alert is about (the monitored device)
 * @param {string} eventName      SSE event name, e.g. 'device_alert'
 * @param {object} opts
 * @param {string} opts.alertType  logical type: 'battery_low' | 'device_offline' | 'gps_off'
 * @param {string} opts.title      push notification title
 * @param {string} opts.body       push notification body
 * @param {object} [opts.extra]    extra fields merged into the SSE/push data payload
 */
const sendDeviceAlert = async (subjectUserId, eventName, { alertType, title, body, extra = {} }) => {
  // Resolve subject name + their circles.
  const userRow = await query('SELECT name FROM users WHERE id = $1', [subjectUserId])
  const subjectName = userRow.rows[0]?.name || 'Someone'

  const circles = await query(
    'SELECT DISTINCT circle_id FROM circle_members WHERE user_id = $1',
    [subjectUserId]
  )
  if (!circles.rows.length) return

  const circleIds = circles.rows.map(r => r.circle_id)
  const timestamp = new Date().toISOString()

  const payload = {
    alertType,
    event_type: alertType,        // AlertsScreen reads item.event_type
    userId: subjectUserId,
    user_id: subjectUserId,
    name: subjectName,
    user_name: subjectName,
    title,
    body,
    created_at: timestamp,
    timestamp,
    ...extra,
  }

  // 1. SSE to every circle member.
  for (const circleId of circleIds) {
    await sendToCircleMembers(circleId, eventName, payload).catch(() => {})
  }

  // 2. Expo push to other members of those circles.
  try {
    const tokens = await query(
      `SELECT DISTINCT u.push_token
         FROM circle_members cm
         JOIN users u ON u.id = cm.user_id
        WHERE cm.circle_id = ANY($1)
          AND u.push_token IS NOT NULL
          AND u.id != $2`,
      [circleIds, subjectUserId]
    )
    await sendPushNotifications(
      tokens.rows.map(t => t.push_token),
      { title, body, data: payload }
    )
  } catch (err) {
    console.error('[alerts] sendDeviceAlert push lookup failed:', err.message)
  }
}

module.exports = { sendDeviceAlert, sendPushNotifications }
