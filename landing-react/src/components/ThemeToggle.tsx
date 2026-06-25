import { useEffect, useState } from 'react'

type Mode = 'light' | 'dark'

function getInitialTheme(): Mode {
  const el = document.documentElement.dataset.theme
  if (el === 'light' || el === 'dark') return el
  try {
    const saved = localStorage.getItem('theme_mode')
    if (saved === 'light' || saved === 'dark') return saved
  } catch { /* ignore */ }
  return 'dark'
}

/**
 * Floating sun/moon button that toggles between light and dark themes.
 * Persists the choice to localStorage('theme_mode') and reflects it on
 * document.documentElement.dataset.theme.
 */
export default function ThemeToggle() {
  const [mode, setMode] = useState<Mode>(getInitialTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = mode
    try {
      localStorage.setItem('theme_mode', mode)
    } catch { /* ignore */ }
  }, [mode])

  const toggle = () => setMode(m => (m === 'dark' ? 'light' : 'dark'))

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {mode === 'dark' ? (
        // Sun icon — shown in dark mode (click to go light)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      ) : (
        // Moon icon — shown in light mode (click to go dark)
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
        </svg>
      )}
    </button>
  )
}
