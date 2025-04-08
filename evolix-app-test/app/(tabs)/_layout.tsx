import { Tabs } from "expo-router";
import { Image } from "react-native";
import { MaterialCommunityIcons, Ionicons } from "@expo/vector-icons";

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerStyle: {
          backgroundColor: "#000000",
          height: 110,
        },
        headerTitleStyle: {
          color: "#FFFFFF",
        },
        tabBarStyle: {
          backgroundColor: "#000000",
          borderTopColor: "transparent",
          borderTopWidth: 0,
          height: 60,
          paddingBottom: 5,
          paddingTop: 5,
        },
        tabBarActiveTintColor: "#FFD700",
        tabBarInactiveTintColor: "#666",
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "400",
        },
        tabBarIconStyle: {
          marginBottom: -4,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: "Home",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="home" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="all-series"
        options={{
          title: "All Series",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="television" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => (
            <Ionicons name="search" size={24} color={color} />
          ),
        }}
      />

      <Tabs.Screen
        name="history"
        options={{
          title: "History",
          tabBarIcon: ({ color }) => (
            <MaterialCommunityIcons name="history" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
