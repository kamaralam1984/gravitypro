// backgroundHeartbeat.js — keeps a family member's "online" status alive even
// when the app is fully closed AND the phone is stationary (no GPS movement
// to trigger a real location fix, and the app/_layout.jsx 60s foreground
// heartbeat stops the moment the JS engine is torn down).
//
// Uses expo-background-task (SDK 52+ replacement for the deprecated
// expo-background-fetch) to periodically wake up and call the SAME
// sendHeartbeat() already used by the foreground heartbeat.
//
// Platform reality, not hidden: Android's WorkManager has a practical ~15min
// floor for periodic work, so that's the best available cadence there
// (reliable if battery-optimization is granted — see services/reliability.js
// and ProfileScreen's "Improve Tracking Reliability"). iOS's BGTaskScheduler
// gives NO app a fixed-interval guarantee — the OS decides when (or whether)
// to run it based on usage patterns/battery. minimumInterval is a request,
// not a promise, on either platform, but especially iOS.
import { Platform } from 'react-native'
import * as TaskManager from 'expo-task-manager'
import * as BackgroundTask from 'expo-background-task'
import { sendHeartbeat } from './location'

const HEARTBEAT_TASK_NAME = 'gravity-background-heartbeat'

if (Platform.OS !== 'web') {
  TaskManager.defineTask(HEARTBEAT_TASK_NAME, async () => {
    try {
      await sendHeartbeat()
      return BackgroundTask.BackgroundTaskResult.Success
    } catch (e) {
      console.error('[backgroundHeartbeat] failed:', e.message)
      return BackgroundTask.BackgroundTaskResult.Failed
    }
  })
}

export const startHeartbeatTask = async () => {
  if (Platform.OS === 'web') return
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME).catch(() => false)
    if (!isRegistered) {
      await BackgroundTask.registerTaskAsync(HEARTBEAT_TASK_NAME, { minimumInterval: 15 })
    }
  } catch (e) {
    console.warn('[backgroundHeartbeat] start failed:', e?.message)
  }
}

export const stopHeartbeatTask = async () => {
  if (Platform.OS === 'web') return
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(HEARTBEAT_TASK_NAME).catch(() => false)
    if (isRegistered) await BackgroundTask.unregisterTaskAsync(HEARTBEAT_TASK_NAME)
  } catch (e) {
    console.warn('[backgroundHeartbeat] stop failed:', e?.message)
  }
}
