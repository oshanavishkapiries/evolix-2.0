import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Image, ScrollView } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { TVSeries } from '../types/api';
import { getAllTVSeries } from '../services/api';
import SeriesSection from '../components/SeriesSection';
import FeaturedSlider from '../components/FeaturedSlider';

export default function HomeScreen() {
  const [series, setSeries] = useState<TVSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadTVSeries();
  }, []);

  const loadTVSeries = async () => {
    try {
      setLoading(true);
      setError('');

      const response = await getAllTVSeries(1, 20);
      
      if (response.success) {
        setSeries(response.data.results);
      } else {
        setError(response.message || 'Failed to load TV series');
      }
    } catch (err) {
      console.error('Error loading TV series:', err);
      if (err instanceof Error) {
        if (err.message.includes('Network request failed')) {
          setError('Unable to connect to the server. Please check your internet connection and make sure the server is running.');
        } else {
          setError(`Error: ${err.message}`);
        }
      } else {
        setError('An unexpected error occurred while loading TV series');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Stack.Screen 
        options={{
          headerShown: false
        }}
      />
      <View style={styles.container}>
        <View style={styles.header}>
          <Image
            source={require('../../assets/evolix-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {error ? (
          <View style={styles.errorContainer}>
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : loading ? (
          <ActivityIndicator size="large" color="#ffd700" style={styles.loader} />
        ) : (
          <ScrollView showsVerticalScrollIndicator={false}>
            <FeaturedSlider series={series.slice(0, 3)} />
            <View style={styles.sections}>
              <SeriesSection title="Recently Added" series={series.slice(0, 5)} />
              <SeriesSection title="Featured" series={series.slice(5, 10)} />
            </View>
          </ScrollView>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  header: {
    padding: 16,
    paddingTop: "10%",
    borderBottomWidth: 0,
    borderBottomColor: '#333',
    backgroundColor: 'transparent',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  logo: {
    height: 25,
    width: '100%',
  },
  sections: {
    paddingTop: 24,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  error: {
    color: '#ff6b6b',
    textAlign: 'center',
    backgroundColor: 'rgba(255, 107, 107, 0.1)',
    padding: 16,
    borderRadius: 12,
    overflow: 'hidden',
    width: '100%',
  },
}); 