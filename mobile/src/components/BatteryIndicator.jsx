import React from 'react'
import { View, Text, StyleSheet } from 'react-native'
import { Ionicons } from '@expo/vector-icons'
import { Colors } from '../theme/colors'

export const BatteryIndicator = ({ level, showText = false, size = 'sm' }) => {
  if (level === undefined || level === null) return null

  const color = level > 50 ? Colors.success : level > 20 ? Colors.warning : Colors.danger
  const iconName = level > 80 ? 'battery-full' : level > 50 ? 'battery-half' : level > 20 ? 'battery-dead' : 'battery-dead'
  const iconSize = size === 'sm' ? 14 : 18

  return (
    <View style={styles.container}>
      <Ionicons name={iconName} size={iconSize} color={color} />
      {showText && (
        <Text style={[styles.text, { color, fontSize: size === 'sm' ? 11 : 13 }]}>{level}%</Text>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  text: { fontWeight: '600' },
})
