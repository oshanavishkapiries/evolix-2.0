import React, { useEffect, useState } from 'react';
import { View, TextInput, StyleSheet, FlatList, ActivityIndicator, Text, Image, Dimensions, useWindowDimensions } from 'react-native';
import { getAllTVSeries, searchTVSeries } from './utils/api';
import { TVSeries } from './types/api';
import TVSeriesCard from './components/TVSeriesCard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDebounce } from './hooks/useDebounce';
import { Stack } from 'expo-router';

export default function HomeScreen() {
  const [series, setSeries] = useState<TVSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const insets = useSafeAreaInsets();
  const debouncedSearch = useDebounce(searchQuery, 500);
  const { width } = useWindowDimensions();
  const numColumns = Math.max(2, Math.floor(width / 300)); // Minimum 2 columns, then adapt based on screen width

  useEffect(() => {
    loadTVSeries(true);
  }, [debouncedSearch]);

  const loadTVSeries = async (refresh = false) => {
    try {
      if (refresh) {
        setLoading(true);
        setCurrentPage(1);
      } else {
        setLoadingMore(true);
      }
      setError('');

      const page = refresh ? 1 : currentPage;
      const response = debouncedSearch
        ? await searchTVSeries(debouncedSearch)
        : await getAllTVSeries(page, 20);
      
      if (response.success) {
        const newSeries = response.data.results;
        setSeries(prev => refresh ? newSeries : [...prev, ...newSeries]);
        setHasMore(response.data.hasMore);
        if (!refresh) {
          setCurrentPage(prev => prev + 1);
        }
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
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && !loading && !debouncedSearch) {
      loadTVSeries();
    }
  };

  const renderFooter = () => {
    if (!loadingMore) return null;
    return (
      <View style={styles.footerLoader}>
        <ActivityIndicator size="large" color="#ffd700" />
      </View>
    );
  };

  const renderItem = ({ item, index }: { item: TVSeries; index: number }) => {
    const itemWidth = (width - (numColumns + 1) * 16) / numColumns;
    return (
      <View style={[styles.gridItem, { width: itemWidth }]}>
        <TVSeriesCard series={item} />
      </View>
    );
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
            source={require('../assets/evolix-logo.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <TextInput
            style={styles.searchInput}
            placeholder="Search TV Series..."
            placeholderTextColor="#666"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>

        {error ? (
          <Text style={styles.error}>{error}</Text>
        ) : loading && !loadingMore ? (
          <ActivityIndicator size="large" color="#ffd700" style={styles.loader} />
        ) : (
          <FlatList
            data={series}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.list}
            showsVerticalScrollIndicator={false}
            numColumns={numColumns}
            key={numColumns}
            onEndReached={handleLoadMore}
            onEndReachedThreshold={0.5}
            ListFooterComponent={renderFooter}
            refreshing={loading}
            onRefresh={() => loadTVSeries(true)}
          />
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
    marginBottom: 16,
  },
  searchInput: {
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 16,
  },
  list: {
    padding: 16,
  },
  gridItem: {
    flex: 1,
    margin: 8,
  },
  loader: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  footerLoader: {
    paddingVertical: 20,
    alignItems: 'center',
  },
  error: {
    color: '#ff0000',
    textAlign: 'center',
    margin: 16,
  },
}); 