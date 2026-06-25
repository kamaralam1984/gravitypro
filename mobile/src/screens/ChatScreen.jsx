import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Image,
  Platform,
  Alert,
  Linking,
  KeyboardAvoidingView,
} from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import * as ImagePicker from 'expo-image-picker'
import * as Location from 'expo-location'
import * as FileSystem from 'expo-file-system'
import { Audio } from 'expo-av'

import { chatAPI } from '../services/chatApi'
import { storage } from '../utils/storage'
import { useTheme } from '../theme/ThemeContext'
import { useAuthStore } from '../store/authStore'

// react-native-sse: the same native EventSource AlertsScreen uses.
const NativeEventSource = Platform.OS !== 'web' ? require('react-native-sse').default : null

const SSE_URL =
  (process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com') +
  '/api/v1/sse/stream'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTime(ts) {
  try {
    const d = new Date(ts)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function fmtDuration(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0))
  const m = Math.floor(s / 60)
  const r = s % 60
  return `${m}:${String(r).padStart(2, '0')}`
}

// ── Message bubble ──────────────────────────────────────────────────────────────

function MessageBubble({ item, mine, c, styles, onVoicePlay, playingId }) {
  const openLocation = () => {
    if (item.lat == null || item.lng == null) return
    const url = Platform.select({
      ios: `http://maps.apple.com/?ll=${item.lat},${item.lng}`,
      default: `https://www.google.com/maps/search/?api=1&query=${item.lat},${item.lng}`,
    })
    Linking.openURL(url).catch(() => {})
  }

  return (
    <View style={[styles.row, mine ? styles.rowMine : styles.rowOther]}>
      {!mine && (
        item.sender_avatar ? (
          <Image source={{ uri: item.sender_avatar }} style={styles.avatar} />
        ) : (
          <View style={[styles.avatar, styles.avatarFallback]}>
            <Text style={styles.avatarInitial}>
              {(item.sender_name || '?').trim().charAt(0).toUpperCase()}
            </Text>
          </View>
        )
      )}

      <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
        {!mine && !!item.sender_name && (
          <Text style={styles.senderName}>{item.sender_name}</Text>
        )}

        {item.type === 'image' && !!item.media_url && (
          <Image source={{ uri: item.media_url }} style={styles.image} resizeMode="cover" />
        )}

        {item.type === 'location' && (
          <Pressable onPress={openLocation} style={styles.locationChip}>
            <Ionicons name="location" size={18} color={mine ? '#fff' : c.accent} />
            <Text style={[styles.locationText, { color: mine ? '#fff' : c.textPrimary }]}>
              Shared location
            </Text>
            <Ionicons name="open-outline" size={14} color={mine ? 'rgba(255,255,255,0.8)' : c.textMuted} />
          </Pressable>
        )}

        {item.type === 'voice' && (
          <Pressable onPress={() => onVoicePlay(item)} style={styles.voiceChip}>
            <Ionicons
              name={playingId === item.id ? 'pause-circle' : 'play-circle'}
              size={28}
              color={mine ? '#fff' : c.accent}
            />
            <View style={styles.voiceBars}>
              {[6, 12, 8, 16, 10, 14, 7].map((h, i) => (
                <View
                  key={i}
                  style={[styles.voiceBar, { height: h, backgroundColor: mine ? 'rgba(255,255,255,0.7)' : c.accentSoft }]}
                />
              ))}
            </View>
            <Text style={[styles.voiceDuration, { color: mine ? 'rgba(255,255,255,0.85)' : c.textMuted }]}>
              {fmtDuration(item.duration_sec)}
            </Text>
          </Pressable>
        )}

        {(item.type === 'text' || (!item.type && item.text)) && !!item.text && (
          <Text style={[styles.bubbleText, { color: mine ? '#fff' : c.textPrimary }]}>
            {item.text}
          </Text>
        )}

        <Text style={[styles.time, { color: mine ? 'rgba(255,255,255,0.7)' : c.textMuted }]}>
          {fmtTime(item.created_at)}
        </Text>
      </View>
    </View>
  )
}

// ── Screen ──────────────────────────────────────────────────────────────────────

export default function ChatScreen({ route, navigation }) {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const user = useAuthStore(s => s.user)
  const myId = user?.id

  const circleId = route?.params?.circleId
  const circleName = route?.params?.circleName || 'Family Chat'

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recStart, setRecStart] = useState(0)
  const [playingId, setPlayingId] = useState(null)

  const listRef = useRef(null)
  const sseRef = useRef(null)
  const recRef = useRef(null)
  const soundRef = useRef(null)
  const seenIds = useRef(new Set())

  useEffect(() => {
    navigation?.setOptions?.({ title: circleName })
  }, [circleName])

  // ── Merge helper (de-dupes by id, keeps oldest -> newest) ──────────────────────
  const mergeMessages = useCallback((incoming, mode = 'append') => {
    setMessages(prev => {
      const fresh = incoming.filter(m => m && m.id && !seenIds.current.has(m.id))
      fresh.forEach(m => seenIds.current.add(m.id))
      if (!fresh.length) return prev
      return mode === 'prepend' ? [...fresh, ...prev] : [...prev, ...fresh]
    })
  }, [])

  // ── Load history ───────────────────────────────────────────────────────────────
  const loadHistory = useCallback(async () => {
    if (!circleId) { setError('No circle selected'); setLoading(false); return }
    setError('')
    try {
      const res = await chatAPI.history(circleId)
      const list = res?.messages || []
      seenIds.current = new Set(list.map(m => m.id))
      setMessages(list)
    } catch (e) {
      setError('Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [circleId])

  useEffect(() => { loadHistory() }, [loadHistory])

  // ── SSE live ─────────────────────────────────────────────────────────────────
  const connectSSE = useCallback(async () => {
    if (Platform.OS === 'web' || !NativeEventSource || !circleId) return
    const token = await storage.getItem('auth_token')
    if (!token) return
    sseRef.current?.close()
    const es = new NativeEventSource(SSE_URL, { headers: { Authorization: 'Bearer ' + token } })

    // Same subscription pattern AlertsScreen uses for sos_alert/geofence_event.
    es.addEventListener('chat_message', (e) => {
      try {
        const msg = JSON.parse(e.data)
        // Only append messages for the circle we're viewing.
        if (String(msg.circle_id) !== String(circleId)) return
        mergeMessages([msg], 'append')
      } catch (err) {
        console.error('SSE chat_message parse error', err)
      }
    })

    sseRef.current = es
  }, [circleId, mergeMessages])

  useEffect(() => {
    connectSSE()
    return () => sseRef.current?.close()
  }, [connectSSE])

  // ── Auto-scroll to bottom on new message ───────────────────────────────────────
  useEffect(() => {
    if (messages.length) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd?.({ animated: true }))
    }
  }, [messages.length])

  // ── Send text ───────────────────────────────────────────────────────────────
  const sendText = useCallback(async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    setText('')
    try {
      const res = await chatAPI.send(circleId, { type: 'text', text: body })
      if (res?.message) mergeMessages([res.message], 'append')
    } catch (e) {
      setText(body) // restore on failure
      Alert.alert('Error', 'Could not send message.')
    } finally {
      setSending(false)
    }
  }, [text, sending, circleId, mergeMessages])

  // ── Send image ────────────────────────────────────────────────────────────────
  const sendImage = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) return Alert.alert('Permission needed', 'Allow photo access to send images.')
      const r = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.6,
        base64: true,
      })
      if (r.canceled || !r.assets?.[0]?.base64) return
      const a = r.assets[0]
      const ext = (a.uri.split('.').pop() || 'jpg').toLowerCase()
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg'
      setSending(true)
      const { url } = await chatAPI.uploadImage(a.base64, contentType)
      const res = await chatAPI.send(circleId, { type: 'image', media_url: url })
      if (res?.message) mergeMessages([res.message], 'append')
    } catch (e) {
      Alert.alert('Error', 'Could not send image.')
    } finally {
      setSending(false)
    }
  }, [circleId, mergeMessages])

  // ── Share location ──────────────────────────────────────────────────────────────
  const shareLocation = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') return Alert.alert('Permission needed', 'Allow location access to share your position.')
      setSending(true)
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
      const res = await chatAPI.send(circleId, {
        type: 'location',
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      })
      if (res?.message) mergeMessages([res.message], 'append')
    } catch (e) {
      Alert.alert('Error', 'Could not share location.')
    } finally {
      setSending(false)
    }
  }, [circleId, mergeMessages])

  // ── Voice recording ─────────────────────────────────────────────────────────────
  const startRecording = useCallback(async () => {
    try {
      const perm = await Audio.requestPermissionsAsync()
      if (!perm.granted) return Alert.alert('Permission needed', 'Allow microphone access to record voice notes.')
      await Audio.setAudioModeAsync({ allowsRecordingIOS: true, playsInSilentModeIOS: true })
      const { recording: rec } = await Audio.Recording.createAsync(
        Audio.RecordingOptionsPresets.HIGH_QUALITY
      )
      recRef.current = rec
      setRecStart(Date.now())
      setRecording(true)
    } catch (e) {
      setRecording(false)
      Alert.alert('Error', 'Could not start recording.')
    }
  }, [])

  const cancelRecording = useCallback(async () => {
    try { await recRef.current?.stopAndUnloadAsync() } catch {}
    recRef.current = null
    setRecording(false)
  }, [])

  const stopAndSendRecording = useCallback(async () => {
    const rec = recRef.current
    if (!rec) { setRecording(false); return }
    setRecording(false)
    const durationSec = Math.max(1, Math.round((Date.now() - recStart) / 1000))
    try {
      setSending(true)
      await rec.stopAndUnloadAsync()
      const uri = rec.getURI()
      recRef.current = null
      if (!uri) throw new Error('No recording file')
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      })
      const { url } = await chatAPI.uploadVoice(base64, 'audio/m4a')
      const res = await chatAPI.send(circleId, {
        type: 'voice',
        media_url: url,
        duration_sec: durationSec,
      })
      if (res?.message) mergeMessages([res.message], 'append')
    } catch (e) {
      Alert.alert('Error', 'Could not send voice note.')
    } finally {
      setSending(false)
    }
  }, [recStart, circleId, mergeMessages])

  // ── Voice playback ────────────────────────────────────────────────────────────
  const playVoice = useCallback(async (item) => {
    try {
      // Toggle off if same clip is playing.
      if (playingId === item.id) {
        await soundRef.current?.stopAsync()
        await soundRef.current?.unloadAsync()
        soundRef.current = null
        setPlayingId(null)
        return
      }
      if (soundRef.current) {
        await soundRef.current.unloadAsync().catch(() => {})
        soundRef.current = null
      }
      if (!item.media_url) return
      const { sound } = await Audio.Sound.createAsync({ uri: item.media_url })
      soundRef.current = sound
      setPlayingId(item.id)
      sound.setOnPlaybackStatusUpdate((st) => {
        if (st.didJustFinish) {
          setPlayingId(null)
          sound.unloadAsync().catch(() => {})
          soundRef.current = null
        }
      })
      await sound.playAsync()
    } catch (e) {
      setPlayingId(null)
    }
  }, [playingId])

  // Cleanup audio on unmount.
  useEffect(() => () => {
    soundRef.current?.unloadAsync?.().catch(() => {})
    recRef.current?.stopAndUnloadAsync?.().catch(() => {})
  }, [])

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}>
      <StatusBar style={c.statusBarStyle} />

      {/* Header */}
      <LinearGradient
        colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.9)']}
        style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Pressable onPress={() => navigation?.goBack?.()} hitSlop={10} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={26} color={c.textWhite} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle} numberOfLines={1}>{circleName}</Text>
          <Text style={styles.headerSubtitle}>Family chat</Text>
        </View>
      </LinearGradient>

      {/* Body */}
      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={c.accent} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Ionicons name="chatbubble-ellipses-outline" size={48} color={c.danger} />
          <Text style={styles.errorTitle}>{error}</Text>
          <Pressable onPress={loadHistory} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => String(item.id)}
          contentContainerStyle={[styles.list, { paddingBottom: 12 }]}
          onContentSizeChange={() => listRef.current?.scrollToEnd?.({ animated: false })}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="chatbubbles-outline" size={56} color={c.accentDim} />
              <Text style={styles.emptyTitle}>No messages yet</Text>
              <Text style={styles.emptyText}>Say hello to your family circle.</Text>
            </View>
          }
          renderItem={({ item }) => (
            <MessageBubble
              item={item}
              mine={myId != null && String(item.sender_id) === String(myId)}
              c={c}
              styles={styles}
              onVoicePlay={playVoice}
              playingId={playingId}
            />
          )}
        />
      )}

      {/* Composer */}
      <View style={[styles.composer, { paddingBottom: insets.bottom + 8 }]}>
        {recording ? (
          <View style={styles.recRow}>
            <Pressable onPress={cancelRecording} hitSlop={8} style={styles.recIconBtn}>
              <Ionicons name="trash-outline" size={22} color={c.danger} />
            </Pressable>
            <View style={styles.recPulse} />
            <Text style={styles.recText}>Recording… tap send to finish</Text>
            <Pressable onPress={stopAndSendRecording} hitSlop={8} style={styles.sendBtn}>
              <LinearGradient colors={c.gradients.button} style={styles.sendBtnGrad}>
                <Ionicons name="send" size={18} color="#fff" />
              </LinearGradient>
            </Pressable>
          </View>
        ) : (
          <>
            <Pressable onPress={sendImage} hitSlop={6} style={styles.iconBtn} disabled={sending}>
              <Ionicons name="image-outline" size={24} color={c.accent} />
            </Pressable>
            <Pressable onPress={shareLocation} hitSlop={6} style={styles.iconBtn} disabled={sending}>
              <Ionicons name="location-outline" size={24} color={c.accent} />
            </Pressable>
            <TextInput
              style={styles.input}
              value={text}
              onChangeText={setText}
              placeholder="Message…"
              placeholderTextColor={c.textMuted}
              multiline
              editable={!sending}
            />
            {text.trim() ? (
              <Pressable onPress={sendText} hitSlop={6} style={styles.sendBtn} disabled={sending}>
                <LinearGradient colors={c.gradients.button} style={styles.sendBtnGrad}>
                  {sending
                    ? <ActivityIndicator size="small" color="#fff" />
                    : <Ionicons name="send" size={18} color="#fff" />}
                </LinearGradient>
              </Pressable>
            ) : (
              <Pressable onPress={startRecording} hitSlop={6} style={styles.iconBtn} disabled={sending}>
                <Ionicons name="mic-outline" size={26} color={c.accent} />
              </Pressable>
            )}
          </>
        )}
      </View>
    </KeyboardAvoidingView>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep },

  header: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingBottom: 12 },
  backBtn: { padding: 2 },
  headerTitle: { fontSize: 19, fontWeight: '800', color: c.textWhite },
  headerSubtitle: { fontSize: 12, color: c.textMuted, marginTop: 1 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 32 },
  errorTitle: { fontSize: 16, fontWeight: '700', color: c.textSecondary },
  retryBtn: { backgroundColor: c.bgCard, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: c.border },
  retryText: { color: c.accent, fontWeight: '700' },

  emptyBox: { alignItems: 'center', paddingVertical: 100, gap: 10 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: c.textSecondary },
  emptyText: { fontSize: 14, color: c.textMuted },

  list: { padding: 12, gap: 8, flexGrow: 1 },

  row: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginBottom: 4 },
  rowMine: { justifyContent: 'flex-end' },
  rowOther: { justifyContent: 'flex-start' },

  avatar: { width: 30, height: 30, borderRadius: 15 },
  avatarFallback: { backgroundColor: c.bgCardLight, alignItems: 'center', justifyContent: 'center' },
  avatarInitial: { color: c.accent, fontWeight: '800', fontSize: 13 },

  bubble: { maxWidth: '78%', borderRadius: 16, paddingHorizontal: 12, paddingVertical: 8 },
  bubbleMine: { backgroundColor: c.primaryLight, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: c.bgCard, borderWidth: 1, borderColor: c.border, borderBottomLeftRadius: 4 },
  senderName: { fontSize: 12, fontWeight: '700', color: c.accentSoft, marginBottom: 3 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  time: { fontSize: 10, marginTop: 4, alignSelf: 'flex-end' },

  image: { width: 200, height: 200, borderRadius: 12, marginBottom: 2 },

  locationChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  locationText: { fontSize: 14, fontWeight: '600' },

  voiceChip: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 2 },
  voiceBars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 18 },
  voiceBar: { width: 3, borderRadius: 2 },
  voiceDuration: { fontSize: 12, fontWeight: '600' },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 6,
    paddingHorizontal: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: c.border,
    backgroundColor: c.bgDark,
  },
  iconBtn: { padding: 8 },
  input: {
    flex: 1,
    maxHeight: 110,
    minHeight: 40,
    backgroundColor: c.bgCard,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    paddingHorizontal: 14,
    paddingTop: Platform.OS === 'ios' ? 10 : 6,
    paddingBottom: Platform.OS === 'ios' ? 10 : 6,
    color: c.textPrimary,
    fontSize: 15,
  },
  sendBtn: { borderRadius: 20, overflow: 'hidden' },
  sendBtnGrad: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },

  recRow: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 4 },
  recIconBtn: { padding: 6 },
  recPulse: { width: 10, height: 10, borderRadius: 5, backgroundColor: c.danger },
  recText: { flex: 1, color: c.textSecondary, fontSize: 14, fontWeight: '600' },
})
