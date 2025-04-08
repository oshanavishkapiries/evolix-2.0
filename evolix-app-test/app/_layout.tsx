import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { useFonts } from "expo-font";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import CustomSplashScreen from "./components/SplashScreen";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import setNavigationColor from 'react-native-navigation-bar-color';

export default function AppLayout() {
  const [appIsReady, setAppIsReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);

  const [fontsLoaded] = useFonts({});

  useEffect(() => {
    async function prepare() {
      try {
        await setNavigationColor('#000000', true);
        await Promise.all([]);
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
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: "#000000" }}>
        <StatusBar style="light" backgroundColor="#000000" />
        {showSplash ? (
          <CustomSplashScreen onAnimationComplete={handleSplashComplete} />
        ) : (
          <Stack screenOptions={{ headerShown: false }} />
        )}
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
