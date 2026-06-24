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
  accent: '#00C853',
  accentSoft: '#00B248',
  accentDim: '#A5D6B3',

  // Background layers — light/white
  bgDeep: '#FFFFFF',
  bgDark: '#F4F8F5',
  bgMid: '#EDF4EF',
  bgSurface: '#E8F0EB',
  bgCard: '#FFFFFF',
  bgCardLight: '#F4F8F5',
  bgGlass: 'rgba(10,92,53,0.06)',
  bgGlassStrong: 'rgba(10,92,53,0.12)',
  bgOverlay: 'rgba(255,255,255,0.85)',

  // Text — dark
  textPrimary: '#0E1A12',
  textSecondary: '#3a4a40',
  textMuted: '#6E8B78',
  textAccent: '#0A5C35',
  textWhite: '#FFFFFF',

  // Status
  success: '#00A046',
  warning: '#E59400',
  danger: '#D32F2F',
  info: '#0288D1',
  online: '#00A046',
  offline: '#9AA89F',

  // Borders & dividers
  border: 'rgba(10,92,53,0.15)',
  borderStrong: 'rgba(10,92,53,0.3)',
  divider: 'rgba(14,26,18,0.08)',

  // Shadows
  shadowGreen: 'rgba(0,200,83,0.18)',
  shadowDeep: 'rgba(0,0,0,0.12)',

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

export const Gradients = {
  hero: ['#020C05', '#042918', '#0A5C35'],
  card: ['#0F2518', '#0C1E13'],
  button: ['#0D7A45', '#0A5C35'],
  buttonHero: ['#00C853', '#0A5C35'],
  accent: ['#00E676', '#00C853'],
  overlay: ['transparent', 'rgba(2,12,5,0.95)'],
  headerGlass: ['rgba(5,15,8,0.95)', 'rgba(5,15,8,0.8)'],
}
