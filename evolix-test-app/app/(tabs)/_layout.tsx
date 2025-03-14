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
        headerTitle: () => (
          <Image
            source={require("../../assets/evolix-logo.png")}
            style={{
              width: 120,
              height: 35,
              resizeMode: "contain",
            }}
          />
        ),
        tabBarStyle: {
          backgroundColor: "#000000",
          borderTopColor: "#333",
          borderTopWidth: 0.2,
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
        name="search"
        options={{
          title: "Search",
          tabBarIcon: ({ color }) => (
            <Ionicons name="search" size={24} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
