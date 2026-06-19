import React, { useState, useEffect, useRef, useCallback } from 'react'
import { View, Text, StyleSheet, Animated, Pressable, ActivityIndicator, RefreshControl } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { formatDistanceToNow } from 'date-fns'
import { GradientCard } from '../components/ui/GradientCard'
import { circleAPI, geofenceAPI } from '../services/api'
import { Colors } from '../theme/colors'

const ALERT_CONFIG = {
  exit: { icon: 'exit-outline', color: Colors.warning, bg: 'rgba(255,179,0,0.12)', label: 'Left zone' },
  entry: { icon: 'enter-outline', color: Colors.success, bg: 'rgba(0,200,83,0.12)', label: 'Arrived' },
}

export default function AlertsScreen() {
  const insets = useSafeAreaInsets()
  const [events, setEvents] = useState([])
  const [activeCircle, setActiveCircle] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const fadeAnim = useRef(new Animated.Value(0)).current

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setError('')
    try {
      const circleRes = await circleAPI.getAll()
      const circs = circleRes.circles || []
      if (!circs.length) { setLoading(false); return }
      const circle = circs[0]
      setActiveCircle(circle)
      await loadEvents(circle.id)
    } catch (e) {
      setError('Failed to load alerts')
    } finally {
      setLoading(false)
      Animated.timing(fadeAnim, { toValue: 1, duration: 400, useNativeDriver: true }).start()
    }
  }

  const loadEvents = async (circleId) => {
    try {
      const res = await geofenceAPI.getEvents(circleId)
      setEvents(res.events || [])
    } catch (e) {
      setError('Failed to load geofence events')
    }
  }

  const onRefresh = useCallback(async () => {
    setRefreshing(true)
    if (activeCircle) await loadEvents(activeCircle.id)
    setRefreshing(false)
  }, [activeCircle])

  const getMessage = (event) => {
    if (event.event_type === 'exit') return event.user_name + ' left ' + event.zone_name
    if (event.event_type === 'entry') return event.user_name + ' arrived at ' + event.zone_name
    return ''
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      <LinearGradient colors={['rgba(5,15,8,0.98)', 'rgba(5,15,8,0.9)']}
        style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>Alerts</Text>
        <Text style={styles.headerSubtitle}>
          {activeCircle ? 'Geofence events for ' + activeCircle.name : 'Your safety events'}
        </Text>
      </LinearGradient>

      {loading ? (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color={Colors.accent} />
        </View>
      ) : error ? (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle-outline" size={48} color={Colors.danger} />
          <Text style={styles.errorTitle}>Could not load alerts</Text>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable onPress={loadData} style={styles.retryBtn}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : (
        <Animated.FlatList
          style={{ opacity: fadeAnim }}
          data={events}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, { paddingBottom: insets.bottom + 80 }]}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={Colors.accent} />}
          ListEmptyComponent={
            <View style={styles.emptyBox}>
              <Ionicons name="notifications-off-outline" size={64} color={Colors.accentDim} />
              <Text style={styles.emptyTitle}>No alerts yet</Text>
              <Text style={styles.emptyText}>Geofence entry and exit events will appear here.</Text>
            </View>
          }
          renderItem={({ item, index }) => {
            const config = ALERT_CONFIG[item.event_type] || ALERT_CONFIG.entry
            return (
              <AlertItem
                message={getMessage(item)}
                time={new Date(item.created_at)}
                config={config}
                index={index}
              />
            )
          }}
        />
      )}
    </View>
  )
}

function AlertItem({ message, time, config, index }) {
  const slideAnim = useRef(new Animated.Value(30)).current
  const fadeAnim = useRef(new Animated.Value(0)).current
  useEffect(() => {
    setTimeout(() => {
      Animated.parallel([
        Animated.spring(slideAnim, { toValue: 0, tension: 80, friction: 10, useNativeDriver: true }),
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
      ]).start()
    }, index * 60)
  }, [])
  return (
    <Animated.View style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }], marginBottom: 10 }}>
      <GradientCard style={styles.alertCard}>
        <View style={[styles.alertIcon, { backgroundColor: config.bg }]}>
          <Ionicons name={config.icon} size={22} color={config.color} />
        </View>
        <View style={styles.alertBody}>
          <Text style={styles.alertMessage}>{message}</Text>
          <Text style={styles.alertTime}>{formatDistanceToNow(time, { addSuffix: true })}</Text>
        </View>
        <View style={[styles.eventTypeBadge, { backgroundColor: config.bg }]}>
          <Text style={[styles.eventTypeText, { color: config.color }]}>{config.label}</Text>
        </View>
      </GradientCard>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bgDeep },
  header: { paddingHorizontal: 24, paddingBottom: 16 },
  headerTitle: { fontSize: 28, fontWeight: '800', color: Colors.textWhite },
  headerSubtitle: { fontSize: 13, color: Colors.textMuted, marginTop: 2 },
  loadingBox: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  errorBox: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: Colors.textSecondary },
  errorText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center' },
  retryBtn: { backgroundColor: Colors.bgCard, borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12, borderWidth: 1, borderColor: Colors.border },
  retryText: { color: Colors.accent, fontWeight: '700' },
  list: { padding: 16 },
  emptyBox: { alignItems: 'center', paddingVertical: 80, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: Colors.textSecondary },
  emptyText: { fontSize: 14, color: Colors.textMuted, textAlign: 'center', paddingHorizontal: 32 },
  alertCard: { flexDirection: 'row', alignItems: 'center', padding: 16, gap: 14 },
  alertIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  alertBody: { flex: 1, gap: 4 },
  alertMessage: { fontSize: 15, color: Colors.textPrimary, fontWeight: '600' },
  alertTime: { fontSize: 12, color: Colors.textMuted },
  eventTypeBadge: { borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  eventTypeText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 },
})
