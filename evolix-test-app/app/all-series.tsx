import React, { useEffect, useState } from 'react';
import { View, StyleSheet, FlatList, ActivityIndicator, Text, useWindowDimensions } from 'react-native';
import { getAllTVSeries } from './services/api';
import { TVSeries } from './types/api';
import TVSeriesCard from './components/TVSeriesCard';
import { Stack } from 'expo-router';

export default function AllSeriesScreen() {
  const [series, setSeries] = useState<TVSeries[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState('');
  const { width } = useWindowDimensions();
  const numColumns = 3;

  useEffect(() => {
    loadTVSeries(true);
  }, []);

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
      const response = await getAllTVSeries(page, 20);
      
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
      setError('An unexpected error occurred while loading TV series');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    if (!loadingMore && hasMore && !loading) {
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
          title: 'All Series',
          headerStyle: {
            backgroundColor: '#000000',
          },
          headerTintColor: '#FFFFFF',
        }}
      />
      <View style={styles.container}>
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
            columnWrapperStyle={styles.columnWrapper}
            showsVerticalScrollIndicator={false}
            numColumns={numColumns}
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
  list: {
    padding: 16,
  },
  columnWrapper: {
    justifyContent: 'flex-start',
    gap: 16,
  },
  gridItem: {
    marginBottom: 16,
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