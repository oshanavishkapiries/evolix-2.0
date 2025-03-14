import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Image } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack } from 'expo-router';
import { TVSeries } from '../types/api';
import { getAllTVSeries } from '../services/api';
import RecentlyAdded from '../components/RecentlyAdded';

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
      <View style={[styles.container]}>
        <View style={[styles.header, { paddingTop: insets.top + 16 }]}>
          <Image
            source={require('../../assets/evolix-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
        </View>

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : loading ? (
          <ActivityIndicator size="large" color="#ffd700" style={styles.loader} />
        ) : (
          <RecentlyAdded series={series} />
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
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#000000',
  },
  logo: {
    height: 40,
    width: '100%',
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  error: {
    color: '#ff0000',
    textAlign: 'center',
    margin: 16,
  },
}); 