import React, { useMemo } from 'react'
import { View, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Gradients } from '../../theme/colors'
import { useTheme } from '../../theme/ThemeContext'

export const GradientCard = ({ children, style, gradient = Gradients.card, ...props }) => {
  const c = useTheme()
  const styles = useMemo(() => makeStyles(c), [c])
  return (
    <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
      style={[styles.card, style]} {...props}>
      {children}
    </LinearGradient>
  )
}

const makeStyles = (c) => StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: c.border,
    overflow: 'hidden',
  },
})
