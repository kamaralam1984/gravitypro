const { query } = require('../config/db')

const checkGeofenceStatus = async (userId, latitude, longitude) => {
  const locationWKT = `POINT(${longitude} ${latitude})`
  // Only evaluate zones that apply to THIS member:
  //   - zones assigned directly to them (assigned_user_id = userId), or
  //   - shared / circle-wide zones (assigned_user_id IS NULL)
  // ...within circles the member actually belongs to.
  const result = await query(
    `SELECT sz.id, sz.name, sz.circle_id,
       ST_Contains(sz.geom, ST_SetSRID(ST_GeomFromText($1), 4326)) as is_inside
     FROM safe_zones sz
     JOIN circle_members cm ON cm.circle_id = sz.circle_id
     WHERE cm.user_id = $2
       AND (sz.assigned_user_id = $2 OR sz.assigned_user_id IS NULL)`,
    [locationWKT, userId]
  )

  for (const zone of result.rows) {
    const lastEvent = await query(
      'SELECT event_type FROM geofence_events WHERE user_id = $1 AND safe_zone_id = $2 ORDER BY created_at DESC LIMIT 1',
      [userId, zone.id]
    )
    const lastEventType = lastEvent.rows[0]?.event_type || null
    if (zone.is_inside && lastEventType !== 'entry') {
      await query(
        'INSERT INTO geofence_events (user_id, safe_zone_id, event_type, geom) VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromText($4), 4326))',
        [userId, zone.id, 'entry', locationWKT]
      )
      await notifyCircleMembers(userId, zone, 'entry')
    } else if (!zone.is_inside && lastEventType === 'entry') {
      await query(
        'INSERT INTO geofence_events (user_id, safe_zone_id, event_type, geom) VALUES ($1, $2, $3, ST_SetSRID(ST_GeomFromText($4), 4326))',
        [userId, zone.id, 'exit', locationWKT]
      )
      await notifyCircleMembers(userId, zone, 'exit')
    }
  }
}

const notifyCircleMembers = async (userId, zone, eventType) => {
  const membersResult = await query(
    `SELECT u.push_token, u.name as member_name
     FROM circle_members cm
     JOIN users u ON u.id = cm.user_id
     WHERE cm.circle_id = $1 AND cm.user_id != $2 AND u.push_token IS NOT NULL`,
    [zone.circle_id, userId]
  )
  const triggerUser = await query('SELECT name FROM users WHERE id = $1', [userId])
  const userName = triggerUser.rows[0]?.name || 'Someone'
  const tokens = membersResult.rows.map(m => m.push_token)
  if (tokens.length > 0) {
    await sendPushNotifications(tokens, {
      title: eventType === 'entry' ? `${userName} arrived at ${zone.name}` : `${userName} left ${zone.name}`,
      body: eventType === 'entry' ? `${userName} has entered the safe zone.` : `${userName} has exited the safe zone.`,
      data: { type: 'geofence_event', zone_id: zone.id, event_type: eventType, user_id: userId }
    })
  }
  const { sendToCircleMembers } = require('./sse')
  await sendToCircleMembers(zone.circle_id, 'geofence_event', {
    userId,
    userName,
    zoneName: zone.name,
    eventType,
    timestamp: new Date().toISOString()
  }).catch(() => {})
}

const sendPushNotifications = async (tokens, message) => {
  if (!process.env.EXPO_ACCESS_TOKEN) return
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
        'Authorization': `Bearer ${process.env.EXPO_ACCESS_TOKEN}`
      },
      body: JSON.stringify(messages)
    })
  } catch (err) {
    console.error('Push notification error:', err.message)
  }
}

module.exports = { checkGeofenceStatus }
