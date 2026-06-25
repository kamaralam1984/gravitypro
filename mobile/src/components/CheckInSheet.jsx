// CheckInSheet — self-contained bottom-sheet modal with Check-In presets.
//
// A child/member taps a preset ("I'm Home", "Reached School", ...) and every
// circle member receives an instant push + SSE 'checkin' event (handled by the
// backend). Optionally attaches the user's current location.
//
// Self-contained: open it from anywhere with
//   const [open, setOpen] = useState(false)
//   <CheckInSheet visible={open} onClose={() => setOpen(false)} circleId={circleId} />
// `circleId` is optional — omit it to broadcast to all of the user's circles.

import React, { useState } from 'react'
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  ToastAndroid,
  Platform,
  Alert,
} from 'react-native'
import { useTheme } from '../theme/ThemeContext'
import { checkinsApi } from '../services/checkinsApi'
import { getCurrentLocation } from '../services/location'

// type + message + emoji for each preset button.
const PRESETS = [
  { type: 'home',    emoji: '🏠', label: "I'm Home",        message: "I'm home" },
  { type: 'school',  emoji: '🏫', label: 'Reached School',  message: 'Reached school' },
  { type: 'tuition', emoji: '📚', label: 'Reached Tuition', message: 'Reached tuition' },
  { type: 'office',  emoji: '🏢', label: 'Reached Office',  message: 'Reached office' },
  { type: 'safe',    emoji: '✅', label: 'Reached Safely',  message: 'Reached safely' },
]

const showToast = (msg) => {
  if (Platform.OS === 'android') ToastAndroid.show(msg, ToastAndroid.SHORT)
  else Alert.alert('Check-In', msg)
}

export default function CheckInSheet({ visible, onClose, circleId }) {
  const c = useTheme()
  const [sending, setSending] = useState(null) // holds the type being sent

  const send = async (preset) => {
    if (sending) return
    setSending(preset.type)
    // Best-effort location — never block the check-in on it.
    let lat, lng
    try {
      const pos = await getCurrentLocation()
      lat = pos?.coords?.latitude
      lng = pos?.coords?.longitude
    } catch (_) {}

    try {
      await checkinsApi.send({
        ...(circleId ? { circle_id: circleId } : {}),
        type: preset.type,
        message: preset.message,
        ...(typeof lat === 'number' ? { lat } : {}),
        ...(typeof lng === 'number' ? { lng } : {}),
      })
      showToast(`${preset.emoji} ${preset.message} — your circle was notified`)
      onClose?.()
    } catch (e) {
      console.error('check-in failed', e)
      Alert.alert('Failed', 'Could not send your check-in. Please try again.')
    } finally {
      setSending(null)
    }
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity
        style={[styles.backdrop, { backgroundColor: c.bgOverlay || 'rgba(0,0,0,0.6)' }]}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity activeOpacity={1} style={[styles.sheet, { backgroundColor: c.bgCard }]}>
          <View style={[styles.grabber, { backgroundColor: c.border }]} />
          <Text style={[styles.title, { color: c.textPrimary }]}>Check In</Text>
          <Text style={[styles.subtitle, { color: c.textMuted }]}>
            Let your circle know where you are
          </Text>

          {PRESETS.map((p) => {
            const busy = sending === p.type
            return (
              <TouchableOpacity
                key={p.type}
                style={[
                  styles.btn,
                  { backgroundColor: c.bgCardLight, borderColor: c.border },
                  sending && !busy && { opacity: 0.5 },
                ]}
                disabled={!!sending}
                onPress={() => send(p)}
              >
                <Text style={styles.emoji}>{p.emoji}</Text>
                <Text style={[styles.btnLabel, { color: c.textPrimary }]}>{p.label}</Text>
                {busy ? (
                  <ActivityIndicator color={c.accent} />
                ) : (
                  <Text style={[styles.chev, { color: c.textMuted }]}>›</Text>
                )}
              </TouchableOpacity>
            )
          })}

          <TouchableOpacity style={styles.cancel} onPress={onClose} disabled={!!sending}>
            <Text style={[styles.cancelText, { color: c.textMuted }]}>Cancel</Text>
          </TouchableOpacity>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  )
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end' },
  sheet: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 32,
  },
  grabber: {
    width: 44,
    height: 5,
    borderRadius: 3,
    alignSelf: 'center',
    marginBottom: 14,
  },
  title: { fontSize: 22, fontWeight: '800' },
  subtitle: { fontSize: 13, marginTop: 2, marginBottom: 16 },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderRadius: 16,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  emoji: { fontSize: 22, marginRight: 14 },
  btnLabel: { flex: 1, fontSize: 16, fontWeight: '700' },
  chev: { fontSize: 22, fontWeight: '700' },
  cancel: { alignItems: 'center', paddingVertical: 14, marginTop: 4 },
  cancelText: { fontSize: 15, fontWeight: '600' },
})
