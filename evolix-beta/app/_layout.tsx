import { useEffect, useState } from 'react';
import { Tabs } from 'expo-router';
import { useFonts } from 'expo-font';
import { StatusBar } from 'expo-status-bar';
import { View, Image } from 'react-native';
import CustomSplashScreen from './components/SplashScreen';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

export default function AppLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const [fontsLoaded] = useFonts({
    // Add any custom fonts here if needed
  });

  useEffect(() => {
    async function prepare() {
      try {
        // Pre-load fonts, make any API calls you need to do here
        await Promise.all([
          // Add other initialization tasks here
        ]);
      } catch (e) {
        console.warn(e);
      } finally {
        setAppIsReady(true);
      }
    }

    prepare();
  }, []);

  const handleSplashComplete = () => {
    setShowSplash(false);
  };

  if (!appIsReady || !fontsLoaded) {
    return null;
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#000000' }}>
      <StatusBar style="light" backgroundColor="#000000" />
      {showSplash ? (
        <CustomSplashScreen onAnimationComplete={handleSplashComplete} />
      ) : (
        <Tabs
          screenOptions={{
            headerStyle: {
              backgroundColor: '#000000',
              height: 110,
            },
            headerTitleStyle: {
              color: '#FFFFFF',
            },
            headerTitle: () => (
              <Image
                source={require('../assets/evolix-logo.png')}
                style={{
                  width: 120,
                  height: 35,
                  resizeMode: 'contain',
                }}
              />
            ),
            tabBarStyle: {
              backgroundColor: '#000000',
              borderTopColor: '#333',
              borderTopWidth: 0.2,
              height: 60,
              paddingBottom: 5,
              paddingTop: 5,
            },
            tabBarActiveTintColor: '#FFD700',
            tabBarInactiveTintColor: '#666',
            tabBarLabelStyle: {
              fontSize: 10,
              fontWeight: '400',
            },
            tabBarIconStyle: {
              marginBottom: -4,
            },
          }}
        >
          <Tabs.Screen
            name="index"
            options={{
              title: 'Home',
              tabBarIcon: ({ color }) => (
                <MaterialCommunityIcons name="home" size={24} color={color} />
              ),
            }}
          />
          <Tabs.Screen
            name="search"
            options={{
              title: 'Search',
              tabBarIcon: ({ color }) => (
                <Ionicons name="search" size={24} color={color} />
              ),
            }}
          />
        </Tabs>
      )}
    </View>
  );
}
