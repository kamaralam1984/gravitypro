import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TextInput,
  Pressable,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Image,
} from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { chatAPI } from '../services/api'
import { storage } from '../utils/storage'
import { Colors, Gradients } from '../theme/colors'

const NativeEventSource = Platform.OS !== 'web' ? require('react-native-sse').default : null

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(dateStr) {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return ''
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

function getInitials(name) {
  if (!name) return '?'
  const parts = name.trim().split(' ')
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

// ── Avatar component ─────────────────────────────────────────────────────────

function MsgAvatar({ name, avatarUrl, size = 32 }) {
  const [imgError, setImgError] = useState(false)
  const initials = getInitials(name)

  if (avatarUrl && !imgError) {
    return (
      <Image
        source={{ uri: avatarUrl }}
        style={[styles.avatarImg, { width: size, height: size, borderRadius: size / 2 }]}
        onError={() => setImgError(true)}
      />
    )
  }

  return (
    <LinearGradient
      colors={Gradients.button}
      style={[styles.avatarFallback, { width: size, height: size, borderRadius: size / 2 }]}>
      <Text style={[styles.avatarInitials, { fontSize: size * 0.38 }]}>{initials}</Text>
    </LinearGradient>
  )
}

// ── Message Bubble ────────────────────────────────────────────────────────────

function MessageBubble({ item, myUserId, showSenderInfo }) {
  const isMe = item.user_id === myUserId || item.userId === myUserId

  if (isMe) {
    return (
      <View style={styles.rowRight}>
        <View style={styles.bubbleRight}>
          <Text style={styles.bubbleTextRight}>{item.text}</Text>
        </View>
        <Text style={styles.timeRight}>{formatTime(item.created_at || item.createdAt)}</Text>
      </View>
    )
  }

  return (
    <View style={styles.rowLeft}>
      {showSenderInfo ? (
        <MsgAvatar
          name={item.user_name || item.userName}
          avatarUrl={item.user_avatar || item.userAvatar}
          size={32}
        />
      ) : (
        <View style={styles.avatarSpacer} />
      )}
      <View style={styles.bubbleLeftGroup}>
        {showSenderInfo && (
          <Text style={styles.senderName}>{item.user_name || item.userName || 'Member'}</Text>
        )}
        <View style={styles.bubbleLeft}>
          <Text style={styles.bubbleTextLeft}>{item.text}</Text>
        </View>
        <Text style={styles.timeLeft}>{formatTime(item.created_at || item.createdAt)}</Text>
      </View>
    </View>
  )
}

// ── Main Screen ───────────────────────────────────────────────────────────────

export default function ChatScreen() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const route = useRoute()
  const { circleId, circleName } = route.params || {}

  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [myUserId, setMyUserId] = useState(null)
  const [inputText, setInputText] = useState('')
  const [sending, setSending] = useState(false)

  const flatListRef = useRef(null)
  const sseRef = useRef(null)
  const inputRef = useRef(null)

  // Load current user id from storage once
  useEffect(() => {
    storage.getItem('user_data').then((raw) => {
      if (raw) {
        try {
          const user = typeof raw === 'string' ? JSON.parse(raw) : raw
          setMyUserId(user.id || user.userId)
        } catch {}
      }
    })
  }, [])

  // Fetch message history
  const loadMessages = useCallback(async () => {
    if (!circleId) return
    setLoading(true)
    try {
      const res = await chatAPI.getMessages(circleId)
      setMessages(res.messages || [])
    } catch (err) {
      console.error('ChatScreen: failed to load messages', err)
    } finally {
      setLoading(false)
    }
  }, [circleId])

  useEffect(() => {
    loadMessages()
  }, [loadMessages])

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (messages.length > 0) {
      setTimeout(() => {
        flatListRef.current?.scrollToEnd({ animated: true })
      }, 80)
    }
  }, [messages.length])

  // SSE — listen for new_message events
  useEffect(() => {
    if (!circleId || Platform.OS === 'web' || !NativeEventSource) return

    let es = null

    const connectSSE = async () => {
      const token = await storage.getItem('auth_token')
      if (!token) return

      const SSE_URL =
        (process.env.EXPO_PUBLIC_API_URL || 'https://gravitypro.kvlbusinesssolutions.com') +
        '/api/v1/sse/stream'

      es = new NativeEventSource(SSE_URL, {
        headers: { Authorization: 'Bearer ' + token },
      })

      es.addEventListener('new_message', (e) => {
        try {
          const data = JSON.parse(e.data)
          // Only handle messages for this circle
          if (data.circleId !== circleId) return
          setMessages((prev) => {
            // Deduplicate by id
            if (prev.some((m) => m.id === data.id)) return prev
            return [...prev, data]
          })
        } catch (err) {
          console.error('ChatScreen SSE parse error', err)
        }
      })

      sseRef.current = es
    }

    connectSSE()

    return () => {
      es?.close()
      sseRef.current = null
    }
  }, [circleId])

  const handleSend = async () => {
    const text = inputText.trim()
    if (!text || sending) return
    setInputText('')
    setSending(true)
    try {
      await chatAPI.sendMessage(circleId, text)
      // The SSE event will append the message; if SSE isn't available, reload
      if (Platform.OS === 'web' || !NativeEventSource) {
        await loadMessages()
      }
    } catch (err) {
      console.error('ChatScreen: failed to send message', err)
      // Put text back so user doesn't lose it
      setInputText(text)
    } finally {
      setSending(false)
      inputRef.current?.focus()
    }
  }

  // Determine whether to show sender info (avatar + name) for consecutive messages
  const shouldShowSenderInfo = (index) => {
    if (index === 0) return true
    const current = messages[index]
    const prev = messages[index - 1]
    const currentId = current.user_id || current.userId
    const prevId = prev.user_id || prev.userId
    return currentId !== prevId
  }

  const renderItem = ({ item, index }) => (
    <MessageBubble
      item={item}
      myUserId={myUserId}
      showSenderInfo={shouldShowSenderInfo(index)}
    />
  )

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* Header */}
      <LinearGradient
        colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.88)']}
        style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={8}>
          <Ionicons name="chevron-back" size={24} color={Colors.accent} />
        </Pressable>
        <View style={styles.headerCenter}>
          <LinearGradient colors={Gradients.button} style={styles.headerIconBg}>
            <Ionicons name="chatbubbles" size={18} color={Colors.accent} />
          </LinearGradient>
          <View>
            <Text style={styles.headerTitle} numberOfLines={1}>{circleName || 'Circle Chat'}</Text>
            <Text style={styles.headerSubtitle}>Family chat</Text>
          </View>
        </View>
        <View style={styles.headerRight} />
      </LinearGradient>

      {/* Message List */}
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}>

        {loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color={Colors.accent} />
            <Text style={styles.loadingText}>Loading messages…</Text>
          </View>
        ) : messages.length === 0 ? (
          <View style={styles.emptyBox}>
            <LinearGradient colors={Gradients.button} style={styles.emptyIconBg}>
              <Ionicons name="chatbubbles-outline" size={40} color={Colors.accent} />
            </LinearGradient>
            <Text style={styles.emptyTitle}>No messages yet</Text>
            <Text style={styles.emptyText}>Say hi!</Text>
          </View>
        ) : (
          <FlatList
            ref={flatListRef}
            data={messages}
            keyExtractor={(item, i) => item.id || String(i)}
            renderItem={renderItem}
            contentContainerStyle={[styles.messageList, { paddingBottom: 12 }]}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: false })}
          />
        )}

        {/* Input Bar */}
        <View style={[styles.inputBar, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              style={styles.textInput}
              value={inputText}
              onChangeText={setInputText}
              placeholder="Message…"
              placeholderTextColor={Colors.textMuted}
              multiline
              maxLength={2000}
              returnKeyType="default"
              blurOnSubmit={false}
            />
          </View>
          <Pressable
            onPress={handleSend}
            disabled={!inputText.trim() || sending}
            style={({ pressed }) => [
              styles.sendBtn,
              (!inputText.trim() || sending) && styles.sendBtnDisabled,
              pressed && styles.sendBtnPressed,
            ]}>
            <LinearGradient
              colors={inputText.trim() && !sending ? Gradients.buttonHero : ['#1A3D28', '#142D1E']}
              style={styles.sendBtnGrad}>
              {sending
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="send" size={18} color={inputText.trim() ? '#fff' : Colors.textMuted} />}
            </LinearGradient>
          </Pressable>
        </View>

      </KeyboardAvoidingView>
    </View>
  )
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  flex: { flex: 1 },

  // Header
  header: {
    paddingHorizontal: 16,
    paddingBottom: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: {
    width: 36, height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.bgGlass,
  },
  headerCenter: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  headerIconBg: {
    width: 36, height: 36, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
  },
  headerTitle: { fontSize: 16, fontWeight: '800', color: Colors.textPrimary },
  headerSubtitle: { fontSize: 11, color: Colors.textMuted, marginTop: 1 },
  headerRight: { width: 36 },

  // Loading / Empty
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14 },
  loadingText: { color: Colors.textMuted, fontSize: 14 },
  emptyBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, paddingHorizontal: 40 },
  emptyIconBg: {
    width: 80, height: 80, borderRadius: 24,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: Colors.border,
    marginBottom: 4,
  },
  emptyTitle: { fontSize: 18, fontWeight: '800', color: Colors.textSecondary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },

  // Message list
  messageList: { paddingHorizontal: 12, paddingTop: 12 },

  // Right (my) bubble
  rowRight: {
    alignItems: 'flex-end',
    marginBottom: 4,
  },
  bubbleRight: {
    backgroundColor: Colors.accent,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    maxWidth: '78%',
  },
  bubbleTextRight: { color: '#020C05', fontSize: 15, fontWeight: '600', lineHeight: 21 },
  timeRight: { fontSize: 10, color: Colors.textMuted, marginTop: 3, marginRight: 2 },

  // Left (others') bubble
  rowLeft: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    marginBottom: 4,
    gap: 8,
  },
  avatarSpacer: { width: 32 },
  bubbleLeftGroup: { maxWidth: '78%' },
  senderName: { fontSize: 11, color: Colors.accentSoft, fontWeight: '700', marginBottom: 3, marginLeft: 2 },
  bubbleLeft: {
    backgroundColor: Colors.bgCard,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  bubbleTextLeft: { color: Colors.textPrimary, fontSize: 15, lineHeight: 21 },
  timeLeft: { fontSize: 10, color: Colors.textMuted, marginTop: 3, marginLeft: 2 },

  // Avatar
  avatarImg: { borderWidth: 1, borderColor: Colors.border },
  avatarFallback: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: Colors.border },
  avatarInitials: { color: '#fff', fontWeight: '800' },

  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    backgroundColor: Colors.bgDark,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: 16,
    paddingVertical: Platform.OS === 'ios' ? 10 : 6,
    maxHeight: 120,
  },
  textInput: {
    color: Colors.textPrimary,
    fontSize: 15,
    lineHeight: 21,
    padding: 0,
  },
  sendBtn: {
    borderRadius: 22,
    overflow: 'hidden',
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 6,
  },
  sendBtnDisabled: { shadowOpacity: 0, elevation: 0 },
  sendBtnPressed: { opacity: 0.8 },
  sendBtnGrad: {
    width: 44, height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
})
