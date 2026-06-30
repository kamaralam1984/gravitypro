import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import TabNavigator from './TabNavigator'
import ChildHubScreen from '../screens/ChildHubScreen'
import ChildTimelineScreen from '../screens/ChildTimelineScreen'
import ChildScreenTimeScreen from '../screens/ChildScreenTimeScreen'
import AppBlockingScreen from '../screens/AppBlockingScreen'
import SafeZonesScreen from '../screens/SafeZonesScreen'
import ChatScreen from '../screens/ChatScreen'

const Stack = createStackNavigator()

// Wraps the bottom tabs in a stack so parents can push per-child detail
// screens (timeline / screen-time / app blocking) on top of the tabs.
export default function MainNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animationEnabled: true }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="ChildHub" component={ChildHubScreen} />
      <Stack.Screen name="ChildTimeline" component={ChildTimelineScreen} />
      <Stack.Screen name="ChildScreenTime" component={ChildScreenTimeScreen} />
      <Stack.Screen name="AppBlocking" component={AppBlockingScreen} />
      <Stack.Screen name="SafeZones" component={SafeZonesScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
    </Stack.Navigator>
  )
}
