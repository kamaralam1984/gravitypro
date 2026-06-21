import React, { useEffect, useState } from 'react'
import { View, Text, Pressable, StyleSheet, Animated } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { checkForUpdate, downloadUpdate } from '../../services/appUpdates'
import { Colors } from '../../theme/colors'

export default function UpdateBanner() {
  const [update, setUpdate] = useState(null)
  const [dismissed, setDismissed] = useState(false)
  const slideAnim = React.useRef(new Animated.Value(-80)).current

  useEffect(() => {
    checkForUpdate().then(info => {
      if (info) {
        setUpdate(info)
        Animated.spring(slideAnim, { toValue: 0, tension: 60, friction: 10, useNativeDriver: true }).start()
      }
    })
  }, [])

  if (!update || dismissed) return null

  return (
    <Animated.View style={[styles.banner, { transform: [{ translateY: slideAnim }] }]}>
      <Ionicons name="cloud-download-outline" size={18} color="#fff" />
      <View style={styles.text}>
        <Text style={styles.title}>Update v{update.version} available</Text>
        <Text style={styles.sub}>Tap to download the latest version</Text>
      </View>
      <Pressable style={styles.btn} onPress={() => downloadUpdate(update.downloadUrl)}>
        <Text style={styles.btnText}>Update</Text>
      </Pressable>
      <Pressable onPress={() => setDismissed(true)} style={styles.close}>
        <Ionicons name="close" size={16} color="rgba(255,255,255,0.7)" />
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 999,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: Colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 10,
  },
  text: { flex: 1 },
  title: { color: '#fff', fontSize: 13, fontWeight: '700' },
  sub: { color: 'rgba(255,255,255,0.8)', fontSize: 11, marginTop: 1 },
  btn: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  btnText: { color: '#fff', fontSize: 13, fontWeight: '700' },
  close: { padding: 4 },
})
