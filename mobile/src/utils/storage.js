import { Platform } from 'react-native'

let SecureStore = null

const getSecureStore = async () => {
  if (Platform.OS === 'web') return null
  if (!SecureStore) SecureStore = await import('expo-secure-store')
  return SecureStore
}

export const storage = {
  getItem: async (key) => {
    if (Platform.OS === 'web') return localStorage.getItem(key)
    const store = await getSecureStore()
    return store.getItemAsync(key)
  },
  setItem: async (key, value) => {
    if (Platform.OS === 'web') { localStorage.setItem(key, value); return }
    const store = await getSecureStore()
    return store.setItemAsync(key, value)
  },
  deleteItem: async (key) => {
    if (Platform.OS === 'web') { localStorage.removeItem(key); return }
    const store = await getSecureStore()
    return store.deleteItemAsync(key)
  },
}
