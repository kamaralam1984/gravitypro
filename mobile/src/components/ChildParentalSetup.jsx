// ChildParentalSetup — shown ONLY on a child's own device.
//
// Screen-time and app-blocking need two SPECIAL Android permissions that cannot
// be granted by a popup — the child/guardian must enable them in system Settings.
// This card surfaces the missing permissions and deep-links into Settings. It
// renders nothing for parents, on builds without the native modules, or once both
// permissions are granted.

import React, { useState, useCallback } from 'react'
import { View, Text, Pressable, StyleSheet, AppState } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { useFocusEffect } from '@react-navigation/native'
import { useAuthStore } from '../store/authStore'
import { useTheme } from '../theme/ThemeContext'
import {
  parentalNativeAvailable,
  hasUsageAccess,
  openUsageAccessSettings,
  hasAccessibility,
  openAccessibilitySettings,
} from '../services/parentalControl'

export default function ChildParentalSetup() {
  const user = useAuthStore((s) => s.user)
  const c = useTheme()
  // Assume granted until checked, so the card never flashes for parents/non-native.
  const [usage, setUsage] = useState(true)
  const [a11y, setA11y] = useState(true)

  const refresh = useCallback(async () => {
    const [u, a] = await Promise.all([hasUsageAccess(), hasAccessibility()])
    setUsage(u)
    setA11y(a)
  }, [])

  // Re-check whenever the screen is focused and whenever the app returns to the
  // foreground (the user comes back after toggling the permission in Settings).
  useFocusEffect(
    useCallback(() => {
      let active = true
      refresh()
      const sub = AppState.addEventListener('change', (s) => {
        if (s === 'active' && active) refresh()
      })
      return () => {
        active = false
        sub.remove()
      }
    }, [refresh])
  )

  if (user?.account_type !== 'child') return null
  if (!parentalNativeAvailable()) return null // OTA-only / old APK without native modules
  if (usage && a11y) return null // all set — nothing to nag about

  const styles = makeStyles(c)
  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="shield-checkmark" size={20} color={c.accent} />
        <Text style={styles.title}>Finish parental controls setup</Text>
      </View>
      <Text style={styles.sub}>
        Two permissions are needed so your family can see screen time and block apps.
      </Text>

      {!usage && (
        <Pressable style={styles.row} onPress={openUsageAccessSettings}>
          <Ionicons name="time-outline" size={22} color={c.warning} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Enable Usage Access</Text>
            <Text style={styles.rowDesc}>For screen-time tracking</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Pressable>
      )}

      {!a11y && (
        <Pressable style={styles.row} onPress={openAccessibilitySettings}>
          <Ionicons name="lock-closed-outline" size={22} color={c.warning} />
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Enable App Blocking</Text>
            <Text style={styles.rowDesc}>Accessibility service</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={c.textMuted} />
        </Pressable>
      )}
    </View>
  )
}

const makeStyles = (c) =>
  StyleSheet.create({
    card: {
      backgroundColor: c.bgCard,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.borderStrong,
      padding: 16,
      marginHorizontal: 16,
      marginBottom: 12,
    },
    headerRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    title: { color: c.textPrimary, fontSize: 16, fontWeight: '700' },
    sub: { color: c.textMuted, fontSize: 13, marginBottom: 12, lineHeight: 18 },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 12,
      borderTopWidth: 1,
      borderTopColor: c.border,
    },
    rowText: { flex: 1 },
    rowTitle: { color: c.textPrimary, fontSize: 14, fontWeight: '600' },
    rowDesc: { color: c.textMuted, fontSize: 12, marginTop: 2 },
  })
