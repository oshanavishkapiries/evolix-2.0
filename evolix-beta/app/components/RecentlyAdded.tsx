import React from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Image } from 'react-native';
import { Link } from 'expo-router';
import { TVSeries } from '../types/api';

interface RecentlyAddedProps {
  series: TVSeries[];
}

export default function RecentlyAdded({ series }: RecentlyAddedProps) {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Recently Added</Text>
        <Link href="/all-series" asChild>
          <Pressable>
            <Text style={styles.seeAll}>See All</Text>
          </Pressable>
        </Link>
      </View>
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {series.slice(0, 10).map((item) => (
          <Link 
            key={item.id} 
            href={`/series/${item.id}`}
            asChild
          >
            <Pressable style={styles.itemContainer}>
              <Image
                source={{ uri: item.mainPoster.low }}
                style={styles.poster}
                resizeMode="cover"
              />
              <Text style={styles.quality}>
                {item.rating}
              </Text>
              <Text style={styles.itemTitle} numberOfLines={1}>
                {item.title}
              </Text>
            </Pressable>
          </Link>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginVertical: 16,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 12,
  },
  title: {
    color: '#FFFFFF',
    fontSize: 20,
    fontWeight: 'bold',
  },
  seeAll: {
    color: '#FFD700',
    fontSize: 16,
  },
  scrollContent: {
    paddingHorizontal: 16,
  },
  itemContainer: {
    marginRight: 12,
    width: 140,
  },
  poster: {
    width: 140,
    height: 210,
    borderRadius: 8,
    backgroundColor: '#1a1a1a',
  },
  quality: {
    position: 'absolute',
    top: 8,
    right: 8,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    color: '#FFFFFF',
    fontSize: 12,
  },
  itemTitle: {
    color: '#FFFFFF',
    fontSize: 14,
    marginTop: 8,
  },
}); 