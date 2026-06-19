import React, { useRef, useEffect } from 'react'
import { View, Image, Text, StyleSheet, Animated } from 'react-native'
import { Colors } from '../theme/colors'

export const MemberAvatar = ({ member, size = 48, showStatus = true, isOnline }) => {
  const pulse = useRef(new Animated.Value(1)).current

  useEffect(() => {
    if (isOnline) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulse, { toValue: 1.3, duration: 1200, useNativeDriver: true }),
          Animated.timing(pulse, { toValue: 1, duration: 1200, useNativeDriver: true }),
        ])
      ).start()
    }
  }, [isOnline])

  const initials = member?.name?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??'

  return (
    <View style={[styles.container, { width: size, height: size }]}>
      {member?.avatar_url ? (
        <Image source={{ uri: member.avatar_url }} style={[styles.image, { width: size, height: size, borderRadius: size / 2 }]} />
      ) : (
        <View style={[styles.placeholder, { width: size, height: size, borderRadius: size / 2 }]}>
          <Text style={[styles.initials, { fontSize: size * 0.38 }]}>{initials}</Text>
        </View>
      )}
      {showStatus && (
        <View style={[styles.statusWrapper, { bottom: -1, right: -1 }]}>
          {isOnline && (
            <Animated.View style={[styles.statusPulse, { transform: [{ scale: pulse }] }]} />
          )}
          <View style={[styles.statusDot, { backgroundColor: isOnline ? Colors.online : Colors.offline }]} />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  container: { position: 'relative' },
  image: { borderWidth: 2, borderColor: Colors.border },
  placeholder: { backgroundColor: Colors.bgCard, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  initials: { color: Colors.accentSoft, fontWeight: '700' },
  statusWrapper: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  statusDot: { width: 12, height: 12, borderRadius: 6, borderWidth: 2, borderColor: Colors.bgDark, zIndex: 2 },
  statusPulse: { position: 'absolute', width: 16, height: 16, borderRadius: 8, backgroundColor: Colors.online, opacity: 0.4, zIndex: 1 },
})
