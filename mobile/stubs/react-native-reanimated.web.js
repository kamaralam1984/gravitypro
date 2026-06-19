import { Animated as RNAnimated, View, Text, ScrollView, Image, FlatList } from 'react-native'
import React, { useRef, useCallback } from 'react'

// Web-safe stubs for react-native-reanimated
export const useSharedValue = (init) => ({ value: init })
export const useAnimatedStyle = (fn) => fn()
export const useAnimatedScrollHandler = () => ({})
export const useAnimatedRef = () => useRef(null)
export const useAnimatedGestureHandler = (handlers) => handlers
export const useDerivedValue = (fn) => ({ value: fn() })
export const useAnimatedReaction = (prepare, react) => {}
export const useAnimatedProps = (fn) => fn()
export const useAnimatedSensor = () => ({ sensor: { value: { x: 0, y: 0, z: 0 } }, unregister: () => {} })
export const useScrollViewOffset = () => ({ value: 0 })
export const useAnimatedKeyboard = () => ({ height: { value: 0 } })

export const withTiming = (toValue, config, callback) => { callback?.(true); return toValue }
export const withSpring = (toValue, config, callback) => { callback?.(true); return toValue }
export const withDelay = (delay, animation) => animation
export const withSequence = (...animations) => animations[animations.length - 1]
export const withRepeat = (animation) => animation
export const runOnJS = (fn) => fn
export const runOnUI = (fn) => fn
export const cancelAnimation = () => {}
export const interpolate = (val, input, output) => {
  if (val <= input[0]) return output[0]
  if (val >= input[input.length - 1]) return output[output.length - 1]
  for (let i = 0; i < input.length - 1; i++) {
    if (val >= input[i] && val <= input[i + 1]) {
      const t = (val - input[i]) / (input[i + 1] - input[i])
      return output[i] + t * (output[i + 1] - output[i])
    }
  }
  return output[0]
}
export const Extrapolation = { CLAMP: 'clamp', EXTEND: 'extend', IDENTITY: 'identity' }
export const Easing = {
  linear: (t) => t,
  ease: (t) => t,
  in: (fn) => fn,
  out: (fn) => fn,
  inOut: (fn) => fn,
  bezier: () => (t) => t,
  circle: (t) => t,
  sin: (t) => t,
  exp: (t) => t,
  back: () => (t) => t,
  elastic: () => (t) => t,
  bounce: (t) => t,
  quad: (t) => t,
  cubic: (t) => t,
  poly: () => (t) => t,
  step0: (t) => t,
  step1: (t) => t,
}

export const createAnimatedComponent = (Component) => Component

export const Animated = {
  View,
  Text,
  ScrollView,
  Image,
  FlatList,
  createAnimatedComponent,
}

export default {
  View,
  Text,
  ScrollView,
  Image,
  FlatList,
  useSharedValue,
  useAnimatedStyle,
  useAnimatedScrollHandler,
  useAnimatedRef,
  useDerivedValue,
  withTiming,
  withSpring,
  withDelay,
  withSequence,
  withRepeat,
  runOnJS,
  cancelAnimation,
  interpolate,
  Extrapolation,
  Easing,
  createAnimatedComponent,
  Animated,
}

export { RNAnimated }
