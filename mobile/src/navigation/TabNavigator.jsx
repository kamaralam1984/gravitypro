import React, { useState, useEffect } from 'react'
import { View, StyleSheet, Platform } from 'react-native'
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs'
import { BlurView } from 'expo-blur'
import { Ionicons } from '@expo/vector-icons'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import HomeScreen from '../screens/HomeScreen'
import MapScreen from '../screens/MapScreen'
import CirclesScreen from '../screens/CirclesScreen'
import AlertsScreen from '../screens/AlertsScreen'
import ProfileScreen from '../screens/ProfileScreen'
import WebPanelScreen from '../screens/WebPanelScreen'
import { Colors } from '../theme/colors'
import { useAuthStore } from '../store/authStore'

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

// Icon map for each tab
const TAB_ICONS = {
  Home: { active: 'home', inactive: 'home-outline' },
  Map: { active: 'map', inactive: 'map-outline' },
  Circles: { active: 'people', inactive: 'people-outline' },
  Alerts: { active: 'notifications', inactive: 'notifications-outline' },
  Panel: { active: 'grid', inactive: 'grid-outline' },
  Profile: { active: 'person', inactive: 'person-outline' },
}

export default function TabNavigator({ unresolvedSosCount = 0 }) {
  const insets = useSafeAreaInsets()
  const user = useAuthStore(s => s.user)
  // Explicit child check: child if account_type OR role says child.
  // Default to child (false isParent) when user not yet loaded — safer than defaulting to parent.
  const isParent = user != null && (user.account_type === 'parent' || user.role === 'parent')

  return (
    <Tab.Navigator
      // Force full remount when role changes so React Navigation rebuilds tabs from scratch
      key={isParent ? 'parent-tabs' : 'child-tabs'}
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarShowLabel: true,
        tabBarActiveTintColor: Colors.accent,
        tabBarInactiveTintColor: Colors.textMuted,
        tabBarStyle: {
          position: 'absolute',
          borderTopWidth: 0,
          height: 65 + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 8,
          elevation: 0,
          shadowOpacity: 0,
          backgroundColor: 'transparent',
        },
        tabBarBackground: () => <TabBarBackground />,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '600',
          letterSpacing: 0.3,
        },
        tabBarIcon: ({ focused, color }) => {
          const icons = TAB_ICONS[route.name]
          return (
            <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
              <Ionicons
                name={icons ? (focused ? icons.active : icons.inactive) : 'ellipse-outline'}
                size={22}
                color={color}
              />
            </View>
          )
        },
      })}>

      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="Map"
        component={MapScreen}
        options={{ tabBarLabel: 'Map' }}
      />
      {isParent && (
        <Tab.Screen
          name="Circles"
          component={CirclesScreen}
          options={{ tabBarLabel: 'Circles' }}
        />
      )}
      <Tab.Screen
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarLabel: 'Alerts',
          tabBarBadge: unresolvedSosCount > 0 ? unresolvedSosCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: Colors.danger,
            color: '#fff',
            fontSize: 10,
            fontWeight: '700',
          },
        }}
      />
      {isParent && (
        <Tab.Screen
          name="Panel"
          component={WebPanelScreen}
          options={{ tabBarLabel: 'Dashboard' }}
        />
      )}
      <Tab.Screen
        name="Profile"
        component={ProfileScreen}
        options={{ tabBarLabel: 'Profile' }}
      />
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
