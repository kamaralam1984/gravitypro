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

  if (finalStatus !== 'granted') {
    console.warn('Push notification permission not granted')
    return null
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
