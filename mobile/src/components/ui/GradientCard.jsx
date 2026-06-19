import React from 'react'
import { View, StyleSheet } from 'react-native'
import { LinearGradient } from 'expo-linear-gradient'
import { Colors, Gradients } from '../../theme/colors'

export const GradientCard = ({ children, style, gradient = Gradients.card, ...props }) => (
  <LinearGradient colors={gradient} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }}
    style={[styles.card, style]} {...props}>
    {children}
  </LinearGradient>
)

const styles = StyleSheet.create({
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: Colors.border,
    overflow: 'hidden',
  },
})
