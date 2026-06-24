export const darkColors = {
  // Primary dark green palette
  primary: '#0A5C35',
  primaryDark: '#063D22',
  primaryDeep: '#042918',
  primaryLight: '#0D7A45',
  primaryBright: '#10A05C',
  accent: '#00E676',
  accentSoft: '#00C853',
  accentDim: '#1B5E3B',

  // Background layers
  bgDeep: '#020C05',
  bgDark: '#050F08',
  bgMid: '#081510',
  bgSurface: '#0C1E13',
  bgCard: '#0F2518',
  bgCardLight: '#132D1E',
  bgGlass: 'rgba(10,92,53,0.15)',
  bgGlassStrong: 'rgba(10,92,53,0.3)',
  bgOverlay: 'rgba(2,12,5,0.85)',

  // Text
  textPrimary: '#E8F5E9',
  textSecondary: '#A5D6B3',
  textMuted: '#5E8B6E',
  textAccent: '#00E676',
  textWhite: '#FFFFFF',

  // Status
  success: '#00C853',
  warning: '#FFB300',
  danger: '#E53935',
  info: '#29B6F6',
  online: '#00E676',
  offline: '#5E8B6E',

  // Borders & dividers
  border: 'rgba(0,230,118,0.15)',
  borderStrong: 'rgba(0,230,118,0.3)',
  divider: 'rgba(255,255,255,0.06)',

  // Shadows
  shadowGreen: 'rgba(0,200,83,0.25)',
  shadowDeep: 'rgba(0,0,0,0.6)',

  // Map
  mapPolygonFill: 'rgba(0,200,83,0.12)',
  mapPolygonStroke: '#00C853',
  mapMarkerSelf: '#00E676',
  mapMarkerOther: '#29B6F6',

  // Status bar
  statusBarStyle: 'light',
}

export const lightColors = {
  // Primary green palette — SAME brand greens for consistency
  primary: '#0A5C35',
  primaryDark: '#063D22',
  primaryDeep: '#042918',
  primaryLight: '#0D7A45',
  primaryBright: '#10A05C',
  // Brand accents kept IDENTICAL to dark mode.
  accent: '#00E676',
  accentSoft: '#00C853',
  accentDim: '#A5D6B3',

  // Background layers — soft off-white app bg, pure-white card surfaces
  bgDeep: '#FFFFFF',
  bgDark: '#F4F8F5',
  bgMid: '#EDF4EF',
  bgSurface: '#E8F0EB',
  bgCard: '#FFFFFF',
  bgCardLight: '#F8FBF9',
  bgGlass: 'rgba(255,255,255,0.7)',
  bgGlassStrong: 'rgba(255,255,255,0.88)',
  bgOverlay: 'rgba(255,255,255,0.85)',

  // Text — crisp dark on light
  textPrimary: '#0E1A12',
  textSecondary: '#33453B',
  textMuted: '#5A6B60',
  textAccent: '#0A5C35',
  textWhite: '#FFFFFF',

  // Status
  success: '#00A046',
  warning: '#E59400',
  danger: '#D32F2F',
  info: '#0288D1',
  online: '#00A046',
  offline: '#9AA89F',

  // Borders & dividers — subtle green-tinted
  border: '#E2ECE6',
  borderStrong: '#CBDDD2',
  divider: 'rgba(14,26,18,0.08)',

  // Shadows — soft
  shadowGreen: 'rgba(0,200,83,0.16)',
  shadowDeep: 'rgba(14,26,18,0.10)',

  // Map
  mapPolygonFill: 'rgba(0,200,83,0.12)',
  mapPolygonStroke: '#00A046',
  mapMarkerSelf: '#00A046',
  mapMarkerOther: '#0288D1',

  // Status bar
  statusBarStyle: 'dark',
}

// Backward-compat: unmigrated screens still `import { Colors }`.
export const Colors = darkColors

// Dark gradients (the original Gradients object).
export const darkGradients = {
  hero: ['#020C05', '#042918', '#0A5C35'],
  card: ['#0F2518', '#0C1E13'],
  button: ['#0D7A45', '#0A5C35'],
  buttonHero: ['#00C853', '#0A5C35'],
  accent: ['#00E676', '#00C853'],
  overlay: ['transparent', 'rgba(2,12,5,0.95)'],
  headerGlass: ['rgba(5,15,8,0.95)', 'rgba(5,15,8,0.8)'],
}

// Light gradients — SAME keys. Buttons stay brand-green in both modes;
// surfaces become subtle light, overlays/glass light-tinted.
export const lightGradients = {
  hero: ['#FFFFFF', '#EDF4EF', '#E2ECE6'],
  card: ['#FFFFFF', '#F1F6F3'],
  button: ['#10A05C', '#0A5C35'],
  buttonHero: ['#00C853', '#0A5C35'],
  accent: ['#00E676', '#00C853'],
  overlay: ['transparent', 'rgba(255,255,255,0.95)'],
  headerGlass: ['rgba(255,255,255,0.95)', 'rgba(248,251,249,0.8)'],
}

// Attach theme-aware gradients to each palette so useTheme() exposes them:
//   const c = useTheme(); c.gradients.card
darkColors.gradients = darkGradients
lightColors.gradients = lightGradients

// Backward-compat: unmigrated screens still `import { Gradients }`.
export const Gradients = darkGradients
