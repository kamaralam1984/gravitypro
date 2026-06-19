import React, { useRef } from 'react'
import { Pressable, Text, StyleSheet, Animated, View, Platform } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import * as Haptics from 'expo-haptics'
import { Colors, Gradients } from '../../theme/colors'

export const PremiumButton = ({ title, onPress, variant = 'primary', loading, disabled, style, icon }) => {
  const scale = useRef(new Animated.Value(1)).current
  const opacity = useRef(new Animated.Value(1)).current

  const handlePressIn = () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    Animated.parallel([
      Animated.spring(scale, { toValue: 0.96, useNativeDriver: true, tension: 300 }),
      Animated.timing(opacity, { toValue: 0.85, duration: 80, useNativeDriver: true }),
    ]).start()
  }

  const handlePressOut = () => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, tension: 300 }),
      Animated.timing(opacity, { toValue: 1, duration: 100, useNativeDriver: true }),
    ]).start()
  }

  const gradients = {
    primary: Gradients.buttonHero,
    secondary: [Colors.bgCard, Colors.bgCardLight],
    ghost: ['transparent', 'transparent'],
  }

  return (
    <Animated.View style={{ transform: [{ scale }], opacity }}>
      <Pressable onPress={onPress} onPressIn={handlePressIn} onPressOut={handlePressOut}
        disabled={disabled || loading} style={[styles.button, style]}>
        <LinearGradient colors={gradients[variant]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={styles.gradient}>
          {icon && <View style={styles.icon}>{icon}</View>}
          <Text style={[styles.text, variant === 'secondary' && { color: Colors.textSecondary }]}>
            {loading ? 'Please wait...' : title}
          </Text>
        </LinearGradient>
      </Pressable>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  button: {
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: Colors.accentSoft,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  gradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 28,
    gap: 10,
  },
  icon: { alignItems: 'center', justifyContent: 'center' },
  text: { color: Colors.textWhite, fontSize: 16, fontWeight: '700', letterSpacing: 0.3 },
})
