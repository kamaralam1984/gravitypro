import React, { useEffect, useRef } from 'react'
import { View, StyleSheet, Animated } from 'react-native'
import { Colors } from '../theme/colors'

export const PulseRing = ({ color = Colors.accent, size = 60, active = true }) => {
  const ring1 = useRef(new Animated.Value(0)).current
  const ring2 = useRef(new Animated.Value(0)).current
  const opacity1 = useRef(new Animated.Value(0.7)).current
  const opacity2 = useRef(new Animated.Value(0.5)).current

  useEffect(() => {
    if (!active) return

    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          // Reset both rings to start position before each loop
          Animated.timing(ring1, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity1, { toValue: 0.7, duration: 0, useNativeDriver: true }),
          Animated.timing(ring2, { toValue: 0, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity2, { toValue: 0.5, duration: 0, useNativeDriver: true }),
        ]),
        Animated.stagger(400, [
          Animated.parallel([
            Animated.timing(ring1, { toValue: 1, duration: 1800, useNativeDriver: true }),
            Animated.timing(opacity1, { toValue: 0, duration: 1800, useNativeDriver: true }),
          ]),
          Animated.parallel([
            Animated.timing(ring2, { toValue: 1, duration: 1800, useNativeDriver: true }),
            Animated.timing(opacity2, { toValue: 0, duration: 1800, useNativeDriver: true }),
          ]),
        ]),
      ])
    )
    pulse.start()
    return () => pulse.stop()
  }, [active])

  const ringStyle = (scale, opacity) => ({
    position: 'absolute',
    width: size,
    height: size,
    borderRadius: size / 2,
    borderWidth: 2,
    borderColor: color,
    transform: [{ scale: Animated.add(1, Animated.multiply(scale, 1.5)) }],
    opacity,
  })

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {active && (
        <>
          <Animated.View style={ringStyle(ring1, opacity1)} />
          <Animated.View style={ringStyle(ring2, opacity2)} />
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', justifyContent: 'center', position: 'absolute' },
})
