import { Platform } from 'react-native'
import * as FileSystem from 'expo-file-system'

const QUEUE_FILE = FileSystem.documentDirectory + 'gravity_offline_queue.json'
const MAX_QUEUE_SIZE = 500

const readQueue = async () => {
  try {
    const info = await FileSystem.getInfoAsync(QUEUE_FILE)
    if (!info.exists) return []
    const data = await FileSystem.readAsStringAsync(QUEUE_FILE)
    return JSON.parse(data)
  } catch {
    return []
  }
}

export const queueLocation = async (point) => {
  if (Platform.OS === 'web') return
  try {
    let queue = await readQueue()
    queue.push(point)
    if (queue.length > MAX_QUEUE_SIZE) queue = queue.slice(-MAX_QUEUE_SIZE)
    await FileSystem.writeAsStringAsync(QUEUE_FILE, JSON.stringify(queue))
  } catch (e) {
    console.error('[OfflineQueue] queue write failed:', e.message)
  }
}

export const getQueueSize = async () => {
  if (Platform.OS === 'web') return 0
  const queue = await readQueue()
  return queue.length
}

export const flushOfflineQueue = async (token) => {
  if (Platform.OS === 'web') return 0
  const queue = await readQueue()
  if (!queue.length) return 0

  const BASE = __DEV__
    ? 'http://192.168.0.197:3021/api/v1'
    : 'https://gravity.trackalways.com/api/v1'

  const controller = new AbortController()
  const tid = setTimeout(() => controller.abort(), 12000)
  try {
    const res = await fetch(`${BASE}/locations/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ locations: queue }),
      signal: controller.signal,
    })
    clearTimeout(tid)
    if (res.ok) {
      await FileSystem.deleteAsync(QUEUE_FILE, { idempotent: true })
      console.log(`[OfflineQueue] synced ${queue.length} points`)
      return queue.length
    }
  } catch (e) {
    clearTimeout(tid)
    console.error('[OfflineQueue] flush failed:', e.message)
  }
  return 0
}
