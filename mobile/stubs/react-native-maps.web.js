import React from 'react'
import { View, Text } from 'react-native'

const MapPlaceholder = (props) => (
  <View style={[{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0A1A0F' }, props.style]}>
    <Text style={{ color: '#4CAF50', fontSize: 16 }}>Map view — mobile app pe dekhein</Text>
  </View>
)

export default MapPlaceholder
export const Marker = () => null
export const Polyline = () => null
export const Circle = () => null
export const Polygon = () => null
export const Callout = () => null
export const PROVIDER_GOOGLE = 'google'
export const AnimatedRegion = class {
  constructor(region) { this.region = region }
  timing() { return { start: () => {} } }
}
