import React from 'react'
import { View, StyleSheet, Platform } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import HomeScreen from '../screens/HomeScreen'
import CirclesScreen from '../screens/CirclesScreen'
import SafeZonesScreen from '../screens/SafeZonesScreen'
import AlertsScreen from '../screens/AlertsScreen'
import ProfileScreen from '../screens/ProfileScreen'
import { Colors } from '../theme/colors'

const Tab = createBottomTabNavigator()

function TabBarBackground() {
  if (Platform.OS === 'ios') {
    return (
      <BlurView
        intensity={60}
        tint="dark"
        style={StyleSheet.absoluteFill}
      />
    )
  }
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(5,15,8,0.97)' }]} />
}

export default function TabNavigator() {
  const insets = useSafeAreaInsets()

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 1,
          borderTopColor: Colors.border,
          height: 60 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
          elevation: 0,
          backgroundColor: 'transparent',
        },
        tabBarBackground: () => <TabBarBackground />,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
        tabBarIcon: ({ focused, color, size }) => {
          const icons = {
            Map: focused ? 'map' : 'map-outline',
            Circles: focused ? 'people' : 'people-outline',
            Zones: focused ? 'shield-checkmark' : 'shield-checkmark-outline',
            Alerts: focused ? 'notifications' : 'notifications-outline',
            Profile: focused ? 'person' : 'person-outline',
          }
          return (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Ionicons name={icons[route.name]} size={22} color={color} />
            </View>
          )
        },
      })}>
      <Tab.Screen name="Map" component={HomeScreen} options={{ tabBarLabel: 'Map' }} />
      <Tab.Screen name="Circles" component={CirclesScreen} options={{ tabBarLabel: 'Circles' }} />
      <Tab.Screen name="Zones" component={SafeZonesScreen} options={{ tabBarLabel: 'Zones' }} />
      <Tab.Screen name="Alerts" component={AlertsScreen} options={{ tabBarLabel: 'Alerts' }} />
      <Tab.Screen name="Profile" component={ProfileScreen} options={{ tabBarLabel: 'Profile' }} />
    </Tab.Navigator>
  )
}

const styles = StyleSheet.create({
  iconWrap: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  iconWrapActive: {
    backgroundColor: Colors.bgGlassStrong,
  },
})
