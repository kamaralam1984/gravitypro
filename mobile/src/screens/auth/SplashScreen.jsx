import React, { useEffect, useRef } from 'react'
import { View, Text, StyleSheet, Animated, Dimensions } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { StatusBar } from 'expo-status-bar'
import { Ionicons } from '@expo/vector-icons'
import { Colors, Gradients } from '../../theme/colors'

const { width, height } = Dimensions.get('window')

export default function SplashScreen({ onComplete }) {
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  const logoScale = useRef(new Animated.Value(0.3)).current
  const logoOpacity = useRef(new Animated.Value(0)).current
  const textOpacity = useRef(new Animated.Value(0)).current
  const taglineOpacity = useRef(new Animated.Value(0)).current
  const ring1Scale = useRef(new Animated.Value(0)).current
  const ring2Scale = useRef(new Animated.Value(0)).current
  const ring1Opacity = useRef(new Animated.Value(0.6)).current
  const ring2Opacity = useRef(new Animated.Value(0.3)).current

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, tension: 60, friction: 8, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(ring1Scale, { toValue: 1.8, duration: 800, useNativeDriver: true }),
        Animated.timing(ring1Opacity, { toValue: 0, duration: 800, useNativeDriver: true }),
        Animated.timing(ring2Scale, { toValue: 2.8, duration: 1200, useNativeDriver: true }),
        Animated.timing(ring2Opacity, { toValue: 0, duration: 1200, useNativeDriver: true }),
      ]),
      Animated.timing(textOpacity, { toValue: 1, duration: 400, useNativeDriver: true }),
      Animated.timing(taglineOpacity, { toValue: 1, duration: 500, useNativeDriver: true }),
    ]).start(() => {
      setTimeout(() => onCompleteRef.current?.(), 800)
    })
  }, [])

  return (
    <LinearGradient colors={Gradients.hero} style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.center}>
        <View style={styles.logoWrapper}>
          <Animated.View style={[styles.ring, { transform: [{ scale: ring1Scale }], opacity: ring1Opacity }]} />
          <Animated.View style={[styles.ring2, { transform: [{ scale: ring2Scale }], opacity: ring2Opacity }]} />
          <Animated.View style={[styles.logoCircle, { transform: [{ scale: logoScale }], opacity: logoOpacity }]}>
            <LinearGradient colors={Gradients.buttonHero} style={styles.logoGradient}>
              <Ionicons name="location" size={52} color="#fff" />
            </LinearGradient>
          </Animated.View>
        </View>
        <Animated.Text style={[styles.brand, { opacity: textOpacity }]}>GRAVITY</Animated.Text>
        <Animated.Text style={[styles.tagline, { opacity: taglineOpacity }]}>Family Safety & Connection</Animated.Text>
      </View>
      <Animated.Text style={[styles.powered, { opacity: taglineOpacity }]}>by Trackalways</Animated.Text>
    </LinearGradient>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { alignItems: 'center', gap: 20 },
  logoWrapper: { width: 140, height: 140, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  ring: { position: 'absolute', width: 110, height: 110, borderRadius: 55, borderWidth: 2, borderColor: Colors.accentSoft },
  ring2: { position: 'absolute', width: 100, height: 100, borderRadius: 50, borderWidth: 1, borderColor: Colors.accent },
  logoCircle: { width: 110, height: 110, borderRadius: 55, overflow: 'hidden', shadowColor: Colors.accentSoft, shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.6, shadowRadius: 20, elevation: 20 },
  logoGradient: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  brand: { fontSize: 42, fontWeight: '900', color: Colors.textWhite, letterSpacing: 8 },
  tagline: { fontSize: 16, color: Colors.textSecondary, letterSpacing: 1.5 },
  powered: { position: 'absolute', bottom: 50, color: Colors.textMuted, fontSize: 13, letterSpacing: 1 },
})
