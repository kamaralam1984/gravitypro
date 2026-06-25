import React from 'react'
import { createStackNavigator } from '@react-navigation/stack'
import TabNavigator from './TabNavigator'
import ChildHubScreen from '../screens/ChildHubScreen'
import ChildTimelineScreen from '../screens/ChildTimelineScreen'
import SafeZonesScreen from '../screens/SafeZonesScreen'
import AddChildScreen from '../screens/AddChildScreen'
import EmergencyContactsScreen from '../screens/EmergencyContactsScreen'
import ReportsScreen from '../screens/ReportsScreen'
import ChatScreen from '../screens/ChatScreen'
import PlacesScreen from '../screens/PlacesScreen'

const Stack = createStackNavigator()

// Wraps the bottom tabs in a stack so parents can push per-child detail
// screens (timeline / safe zones) on top of the tabs.
export default function MainNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, animationEnabled: true }}>
      <Stack.Screen name="Tabs" component={TabNavigator} />
      <Stack.Screen name="ChildHub" component={ChildHubScreen} />
      <Stack.Screen name="ChildTimeline" component={ChildTimelineScreen} />
      <Stack.Screen name="SafeZones" component={SafeZonesScreen} />
      <Stack.Screen name="AddChild" component={AddChildScreen} />
      <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} />
      <Stack.Screen name="Reports" component={ReportsScreen} />
      <Stack.Screen name="Chat" component={ChatScreen} />
      <Stack.Screen name="Places" component={PlacesScreen} />
    </Stack.Navigator>
  )
}
