import React, { useEffect, useState } from 'react';
import { View, StyleSheet, ActivityIndicator, Text, Image, ScrollView, TouchableOpacity } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, router } from 'expo-router';
import { TVSeries } from '../types/api';
import { getAllTVSeries } from '../services/api';
import SeriesSection from '../components/SeriesSection';
import FeaturedSlider from '../components/FeaturedSlider';
import { WatchHistoryService } from '../services/watchHistory';
import { WatchHistoryItem } from '../types/watchHistory';

export default function HomeScreen() {
  const [series, setSeries] = useState<TVSeries[]>([]);
  const [recentlyWatched, setRecentlyWatched] = useState<WatchHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();

  useEffect(() => {
    loadTVSeries();
    loadRecentlyWatched();
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

  const loadRecentlyWatched = async () => {
    try {
      const historyState = await WatchHistoryService.getWatchHistory();
      setRecentlyWatched(historyState.items.slice(0, 5));
    } catch (error) {
      console.error('Error loading recently watched:', error);
    }
  };

  const handleRecentlyWatchedPress = (item: WatchHistoryItem) => {
    router.push({
      pathname: '/player',
      params: {
        videoUrl: item.videoUrl,
        title: `${item.seriesTitle} - S${item.seasonNumber}E${item.episodeNumber}`,
        episodeId: item.episodeId,
        seriesId: item.seriesId,
        seriesTitle: item.seriesTitle,
        episodeTitle: item.episodeTitle,
        episodeNumber: item.episodeNumber,
        seasonNumber: item.seasonNumber,
        thumbnailUrl: item.thumbnailUrl,
        initialTimestamp: item.timestamp
      }
    });
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
              {recentlyWatched.length > 0 && (
                <View style={styles.recentlyWatchedSection}>
                  <Text style={styles.sectionTitle}>Recently Watched</Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={styles.recentlyWatchedList}
                  >
                    {recentlyWatched.map((item) => (
                      <TouchableOpacity
                        key={item.id}
                        style={styles.recentlyWatchedItem}
                        onPress={() => handleRecentlyWatchedPress(item)}
                      >
                        <Image
                          source={{ uri: item.thumbnailUrl }}
                          style={styles.recentlyWatchedThumbnail}
                          resizeMode="cover"
                        />
                        <Text style={styles.recentlyWatchedTitle} numberOfLines={2}>
                          {item.seriesTitle}
                        </Text>
                        <Text style={styles.recentlyWatchedEpisode}>
                          S{item.seasonNumber}E{item.episodeNumber}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>
              )}
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
  recentlyWatchedSection: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#ffffff',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  recentlyWatchedList: {
    paddingHorizontal: 16,
  },
  recentlyWatchedItem: {
    width: 160,
    marginRight: 16,
  },
  recentlyWatchedThumbnail: {
    width: 160,
    height: 90,
    borderRadius: 8,
    marginBottom: 8,
  },
  recentlyWatchedTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '500',
    marginBottom: 4,
  },
  recentlyWatchedEpisode: {
    color: '#888888',
    fontSize: 12,
  },
}); 