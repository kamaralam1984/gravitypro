import { Platform } from 'react-native'

let Notifications = null
const getNotifications = async () => {
  if (Platform.OS === 'web') return null
  if (!Notifications) Notifications = await import('expo-notifications')
  return Notifications
}

if (Platform.OS !== 'web') {
  import('expo-notifications').then(n => {
    n.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: true,
      }),
    })
  })
}

export const registerForPushNotifications = async () => {
  if (Platform.OS === 'web') return null

  const Device = await import('expo-device')
  if (!Device.isDevice) {
    console.warn('Push notifications only work on physical devices')
    return null
  }

  const n = await getNotifications()
  const { status: existing } = await n.getPermissionsAsync()
  let finalStatus = existing

  if (existing !== 'granted') {
    const { status } = await n.requestPermissionsAsync()
    finalStatus = status
  }

  // On Android an FCM push token can be obtained (and used for silent/data
  // wake-refresh from the parent) WITHOUT the POST_NOTIFICATIONS permission —
  // that permission only governs DISPLAYING banners. So do NOT bail here on
  // Android: register the token anyway so the parent's "Refresh" (remote wake
  // to bring the child online) works even if the child declined notifications.
  // iOS needs the permission to mint an APNs token, so there we can't continue.
  if (finalStatus !== 'granted') {
    console.warn('Push notification permission not granted')
    if (Platform.OS !== 'android') return null
  }

  if (Platform.OS === 'android') {
    await n.setNotificationChannelAsync('gravity-alerts', {
      name: 'Gravity Alerts',
      importance: n.AndroidImportance.HIGH,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00E676',
      sound: 'notification',
    })
  }

  const Constants = (await import('expo-constants')).default
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId
  const token = (await n.getExpoPushTokenAsync({ projectId })).data

  // Register push token with backend so server can send targeted pushes
  try {
    const { storage } = await import('../utils/storage')
    const apiToken = await storage.getItem('auth_token')
    if (apiToken && token) {
      const apiBase = process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com'
      await fetch(`${apiBase}/api/v1/users/me/push-token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + apiToken,
        },
        body: JSON.stringify({ token }),
      })
    }
  } catch (e) {
    console.warn('Failed to register push token', e)
  }

  return token
}

export const scheduleLocalNotification = async ({ title, body, data = {} }) => {
  if (Platform.OS === 'web') return
  const n = await getNotifications()
  await n.scheduleNotificationAsync({
    content: { title, body, data, sound: true },
    trigger: null,
  })
}

// Call this once on app start (e.g. in App.js after login).
// Returns a cleanup function — call it on unmount or logout.
export const setupNotificationListeners = ({ onReceived, onResponse } = {}) => {
  if (Platform.OS === 'web') return () => {}
  let receivedSub, responseSub

  import('expo-notifications').then(n => {
    if (onReceived) {
      receivedSub = n.addNotificationReceivedListener(onReceived)
    }
    if (onResponse) {
      responseSub = n.addNotificationResponseReceivedListener(onResponse)
    }
  })

  return () => {
    receivedSub?.remove()
    responseSub?.remove()
  }
}
