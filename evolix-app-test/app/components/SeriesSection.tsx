import React from 'react';
import { View, Text, StyleSheet, FlatList } from 'react-native';
import { TVSeries } from '../types/api';
import SeriesCard from './SeriesCard';

interface SeriesSectionProps {
  title: string;
  series: TVSeries[];
}

export default function SeriesSection({ title, series }: SeriesSectionProps) {
  return (
    <View style={styles.container}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <FlatList
        data={series}
        renderItem={({ item, index }) => (
          <SeriesCard series={item} index={index} />
        )}
        keyExtractor={(item) => item.id}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.list}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: 24,
  },
  sectionTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '600',
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  list: {
    paddingHorizontal: 16,
  },
}); 