const cron = require('node-cron')
const { query } = require('../config/db')

// BullMQ loaded only when REDIS_URL is configured (scaling phase)
let locationCleanupQueue = null
let geofenceCleanupQueue = null

const initBullMQ = () => {
  if (!process.env.REDIS_URL) return false
  try {
    const { Queue, Worker } = require('bullmq')
    const IORedis = require('ioredis')
    const connection = new IORedis(process.env.REDIS_URL, { maxRetriesPerRequest: null })

    locationCleanupQueue = new Queue('location-cleanup', { connection })
    geofenceCleanupQueue = new Queue('geofence-cleanup', { connection })

    new Worker('location-cleanup', async () => {
      const result = await query("DELETE FROM device_locations WHERE recorded_at < NOW() - INTERVAL '7 days'")
      console.log(`[bullmq] Cleaned ${result.rowCount} old location records`)
    }, { connection })

    new Worker('geofence-cleanup', async () => {
      const result = await query("DELETE FROM geofence_events WHERE created_at < NOW() - INTERVAL '30 days'")
      console.log(`[bullmq] Cleaned ${result.rowCount} old geofence events`)
    }, { connection })

    console.log('[bullmq] Queue workers initialized')
    return true
  } catch (err) {
    console.warn('[bullmq] Unavailable, falling back to node-cron:', err.message)
    return false
  }
}

const startJobs = () => {
  const usingBullMQ = initBullMQ()

  // node-cron schedules jobs — enqueues to BullMQ when scaling, runs directly otherwise
  cron.schedule('0 2 * * *', async () => {
    if (usingBullMQ && locationCleanupQueue) {
      await locationCleanupQueue.add('cleanup', {}, { removeOnComplete: 50, removeOnFail: 20 })
      console.log('[cron] Location cleanup enqueued to BullMQ')
    } else {
      try {
        const result = await query("DELETE FROM device_locations WHERE recorded_at < NOW() - INTERVAL '7 days'")
        console.log(`[cron] Cleaned ${result.rowCount} old location records`)
      } catch (err) {
        console.error('[cron] Location cleanup error:', err.message)
      }
    }
  }, { timezone: 'UTC' })

  cron.schedule('0 3 * * *', async () => {
    if (usingBullMQ && geofenceCleanupQueue) {
      await geofenceCleanupQueue.add('cleanup', {}, { removeOnComplete: 50, removeOnFail: 20 })
      console.log('[cron] Geofence cleanup enqueued to BullMQ')
    } else {
      try {
        const result = await query("DELETE FROM geofence_events WHERE created_at < NOW() - INTERVAL '30 days'")
        console.log(`[cron] Cleaned ${result.rowCount} old geofence events`)
      } catch (err) {
        console.error('[cron] Geofence cleanup error:', err.message)
      }
    }
  }, { timezone: 'UTC' })

  console.log(`[jobs] Background jobs initialized (${usingBullMQ ? 'BullMQ queues' : 'node-cron direct'})`)
}

module.exports = { startJobs }
