import React from "react";
import { View, Text, Image, StyleSheet, Pressable } from "react-native";
import { Link } from "expo-router";
import { TVSeries } from "../types/api";

interface TVSeriesCardProps {
  series: TVSeries;
}

export default function TVSeriesCard({ series }: TVSeriesCardProps) {
  return (
    <Link href={`/series/${series.id}`} asChild>
      <Pressable style={styles.itemContainer}>
        <Image
          source={{ uri: series.mainPoster.low }}
          style={styles.poster}
          resizeMode="cover"
        />
        <Text style={styles.quality}>{series.rating}</Text>
        <Text style={styles.itemTitle} numberOfLines={1}>
          {series.title}
        </Text>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  itemContainer: {
    width: "100%",
  },
  poster: {
    width: "100%",
    height: 210,
    borderRadius: 8,
    backgroundColor: "#1a1a1a",
  },
  quality: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: "rgba(0, 0, 0, 0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    color: "#FFFFFF",
    fontSize: 12,
  },
  itemTitle: {
    color: "#FFFFFF",
    fontSize: 14,
    marginTop: 8,
  },
});
