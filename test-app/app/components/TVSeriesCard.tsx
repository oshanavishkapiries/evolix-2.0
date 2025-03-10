import React from 'react';
import { View, Text, Image, StyleSheet, Pressable } from 'react-native';
import { Link } from 'expo-router';
import { TVSeries } from '../types/api';

interface TVSeriesCardProps {
  series: TVSeries;
}

export default function TVSeriesCard({ series }: TVSeriesCardProps) {
  return (
    <Link href={`/series/${series.id}`} asChild>
      <Pressable style={styles.card}>
        <Image
          source={{ uri: series.mainPoster.low }}
          style={styles.poster}
          resizeMode="cover"
        />
        <View style={styles.overlay}>
          <View style={styles.info}>
            <Text style={styles.title} numberOfLines={2}>
              {series.title}
            </Text>
            <Text style={styles.year}>{series.year}</Text>
            <View style={styles.metadata}>
              <Text style={styles.rating}>⭐ {series.rating}</Text>
              <Text style={styles.seasons}>{series.numberOfSeasons} Seasons</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#1a1a1a',
    borderRadius: 12,
    overflow: 'hidden',
    aspectRatio: 2/3,
    position: 'relative',
  },
  poster: {
    width: '100%',
    height: '100%',
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'flex-end',
    opacity: 0,
  },
  info: {
    padding: 12,
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#ffffff',
    marginBottom: 4,
  },
  year: {
    fontSize: 14,
    color: '#888888',
  },
  metadata: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  rating: {
    fontSize: 14,
    color: '#ffd700',
  },
  seasons: {
    fontSize: 14,
    color: '#888888',
  },
}); 