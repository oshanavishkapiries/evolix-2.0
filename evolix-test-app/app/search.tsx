import React, { useState } from 'react';
import { View, TextInput, StyleSheet, FlatList, ActivityIndicator, Text, Image, Pressable } from 'react-native';
import { searchTVSeries } from './services/api';
import { TVSeries } from './types/api';
import { useDebounce } from './hooks/useDebounce';
import { Link } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

export default function SearchScreen() {
  const [series, setSeries] = useState<TVSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState('');
  const debouncedSearch = useDebounce(searchQuery, 500);
  const insets = useSafeAreaInsets();

  React.useEffect(() => {
    if (debouncedSearch) {
      performSearch();
    } else {
      setSeries([]);
    }
  }, [debouncedSearch]);

  const performSearch = async () => {
    if (!debouncedSearch) return;
    
    try {
      setLoading(true);
      setError('');

      const response = await searchTVSeries(debouncedSearch);
      
      if (response.success) {
        setSeries(response.data.results);
      } else {
        setError(response.message || 'Failed to search TV series');
      }
    } catch (err) {
      console.error('Error searching TV series:', err);
      setError('An unexpected error occurred while searching');
    } finally {
      setLoading(false);
    }
  };

  const renderItem = ({ item }: { item: TVSeries }) => (
    <Link href={`/series/${item.id}`} asChild>
      <Pressable style={styles.listItem}>
        <Image
          source={{ uri: item.mainPoster.low }}
          style={styles.poster}
          resizeMode="cover"
        />
        <View style={styles.itemInfo}>
          <Text style={styles.title} numberOfLines={2}>{item.title}</Text>
          <View style={styles.metaInfo}>
            <Text style={styles.year}>{item.year}</Text>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Text style={styles.rating}>{item.rating}</Text>
            </View>
          </View>
          <Text style={styles.genres} numberOfLines={1}>{item.genres}</Text>
        </View>
      </Pressable>
    </Link>
  );

  return (
    <View style={[styles.container, { paddingTop: insets.top }]}>
      <View style={styles.searchContainer}>
        <Ionicons name="search-outline" size={20} color="#666" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search TV Series..."
          placeholderTextColor="#666"
          value={searchQuery}
          onChangeText={setSearchQuery}
          returnKeyType="search"
        />
        {searchQuery.length > 0 && (
          <Pressable onPress={() => setSearchQuery('')} style={styles.clearButton}>
            <Ionicons name="close-circle" size={20} color="#666" />
          </Pressable>
        )}
      </View>

      {error ? (
        <Text style={styles.error}>{error}</Text>
      ) : loading ? (
        <ActivityIndicator size="large" color="#ffd700" style={styles.loader} />
      ) : series.length > 0 ? (
        <FlatList
          data={series}
          renderItem={renderItem}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
        />
      ) : searchQuery ? (
        <View style={styles.emptyState}>
          <Ionicons name="search" size={48} color="#666" />
          <Text style={styles.noResults}>No results found</Text>
        </View>
      ) : (
        <View style={styles.emptyState}>
          <Ionicons name="search" size={48} color="#666" />
          <Text style={styles.placeholder}>Search for your favorite TV series</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000000',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#000000',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    padding: 12,
    borderRadius: 8,
    color: '#ffffff',
    fontSize: 16,
    paddingLeft: 40,
  },
  clearButton: {
    position: 'absolute',
    right: 24,
    top: '50%',
    transform: [{ translateY: -10 }],
  },
  list: {
    padding: 16,
  },
  listItem: {
    flexDirection: 'row',
    marginBottom: 16,
    backgroundColor: '#1a1a1a',
    borderRadius: 8,
    overflow: 'hidden',
  },
  poster: {
    width: 100,
    height: 150,
  },
  itemInfo: {
    flex: 1,
    padding: 12,
    justifyContent: 'space-between',
  },
  title: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  metaInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  year: {
    color: '#999',
    fontSize: 14,
    marginRight: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rating: {
    color: '#FFD700',
    fontSize: 14,
    marginLeft: 4,
  },
  genres: {
    color: '#999',
    fontSize: 14,
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
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  noResults: {
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 16,
  },
  placeholder: {
    color: '#666',
    textAlign: 'center',
    marginTop: 16,
    fontSize: 16,
  },
});