import React, { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { useColorScheme } from 'react-native'
import { storage } from '../utils/storage'
import { lightColors, darkColors } from './colors'

const STORAGE_KEY = 'theme_mode'

// mode: 'system' | 'light' | 'dark'
const ThemeContext = createContext({
  colors: darkColors,
  mode: 'system',
  setMode: () => {},
})

const resolveColors = (mode, systemScheme) => {
  const effective = mode === 'system' ? (systemScheme || 'dark') : mode
  return effective === 'light' ? lightColors : darkColors
}

export function ThemeProvider({ children }) {
  const systemScheme = useColorScheme()
  const [mode, setModeState] = useState('system')

  // Load persisted preference on mount.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const saved = await storage.getItem(STORAGE_KEY)
        if (alive && (saved === 'system' || saved === 'light' || saved === 'dark')) {
          setModeState(saved)
        }
      } catch {
        // ignore — fall back to 'system'
      }
    })()
    return () => { alive = false }
  }, [])

  const setMode = useMemo(
    () => (next) => {
      setModeState(next)
      storage.setItem(STORAGE_KEY, next).catch(() => {})
    },
    []
  )

  const colors = useMemo(
    () => resolveColors(mode, systemScheme),
    [mode, systemScheme]
  )

  const value = useMemo(
    () => ({ colors, mode, setMode }),
    [colors, mode, setMode]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// Returns the active colors object directly: const c = useTheme(); c.bgDeep
export function useTheme() {
  return useContext(ThemeContext).colors
}

// Returns { mode, setMode } for theme preference controls.
export function useThemeMode() {
  const { mode, setMode } = useContext(ThemeContext)
  return { mode, setMode }
}
