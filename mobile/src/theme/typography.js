import { Platform } from 'react-native'

export const Fonts = {
  regular: Platform.select({ ios: 'System', android: 'Roboto' }),
  medium: Platform.select({ ios: 'System', android: 'Roboto-Medium' }),
  bold: Platform.select({ ios: 'System', android: 'Roboto-Bold' }),
}

export const TextStyles = {
  displayLg: { fontSize: 36, fontWeight: '800', letterSpacing: -0.5 },
  displayMd: { fontSize: 28, fontWeight: '700', letterSpacing: -0.3 },
  displaySm: { fontSize: 22, fontWeight: '700', letterSpacing: -0.2 },
  titleLg: { fontSize: 20, fontWeight: '700' },
  titleMd: { fontSize: 18, fontWeight: '600' },
  titleSm: { fontSize: 16, fontWeight: '600' },
  body: { fontSize: 15, fontWeight: '400', lineHeight: 22 },
  bodySmall: { fontSize: 13, fontWeight: '400', lineHeight: 19 },
  caption: { fontSize: 12, fontWeight: '400', lineHeight: 17 },
  label: { fontSize: 12, fontWeight: '600', letterSpacing: 0.8, textTransform: 'uppercase' },
}
