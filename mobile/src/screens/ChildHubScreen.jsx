import React, { useMemo } from 'react'
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Ionicons } from '@expo/vector-icons'
import { StatusBar } from 'expo-status-bar'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute } from '@react-navigation/native'
import { useTheme } from '../theme/ThemeContext'

const ACTIONS = [
  { key: 'ChildTimeline',   icon: 'map',            title: 'Location Timeline', desc: 'Where they went, stays & trips by day' },
  { key: 'ChildScreenTime', icon: 'phone-portrait', title: 'Screen Time',       desc: 'Apps used today and for how long' },
  { key: 'AppBlocking',     icon: 'lock-closed',    title: 'App Blocking',      desc: 'Block apps until you allow them' },
]

export default function ChildHubScreen() {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  const insets = useSafeAreaInsets()
  const navigation = useNavigation()
  const route = useRoute()
  const member = route.params?.member || {}
  const name = member.name || 'Child'

  return (
    <View style={styles.container}>
      <StatusBar style={c.statusBarStyle} />
      <LinearGradient colors={['#042918', '#0A5C35', '#020C05']} style={[styles.header, { paddingTop: insets.top + 14 }]}>
        <Pressable onPress={() => navigation.goBack()} hitSlop={10} style={styles.back}>
          <Ionicons name="chevron-back" size={24} color={c.textWhite} />
        </Pressable>
        <Text style={styles.headerTitle}>{name}</Text>
        <Text style={styles.headerSub}>Parental controls</Text>
      </LinearGradient>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + 30 }]}>
        {ACTIONS.map(a => (
          <Pressable
            key={a.key}
            onPress={() => navigation.navigate(a.key, { member })}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.85 }]}>
            <LinearGradient colors={c.gradients.card} style={styles.cardGrad}>
              <View style={styles.iconWrap}>
                <Ionicons name={a.icon} size={24} color={c.accent} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardTitle}>{a.title}</Text>
                <Text style={styles.cardDesc}>{a.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={20} color={c.textMuted} />
            </LinearGradient>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  )
}

const makeStyles = (c) => StyleSheet.create({
  container: { flex: 1, backgroundColor: c.bgDeep },
  header: { paddingHorizontal: 20, paddingBottom: 22, borderBottomLeftRadius: 24, borderBottomRightRadius: 24 },
  back: { width: 36, height: 36, justifyContent: 'center' },
  headerTitle: { fontSize: 24, fontWeight: '800', color: c.textWhite, marginTop: 4 },
  headerSub: { fontSize: 13, color: c.textSecondary, marginTop: 2 },
  scroll: { padding: 16, gap: 14 },
  card: { borderRadius: 18, overflow: 'hidden', borderWidth: 1, borderColor: c.border },
  cardGrad: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 },
  iconWrap: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bgGlass, borderWidth: 1, borderColor: c.border },
  cardTitle: { fontSize: 16, fontWeight: '700', color: c.textPrimary },
  cardDesc: { fontSize: 12.5, color: c.textMuted, marginTop: 3 },
})
