import React from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  Pressable,
  Dimensions,
} from "react-native";
import { Link } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { TVSeries } from "../types/api";

interface SeriesCardProps {
  series: TVSeries;
  index: number;
}

const { width } = Dimensions.get("window");
const CARD_WIDTH = width * 0.65;
const CARD_HEIGHT = CARD_WIDTH * 0.56;

export default function SeriesCard({ series, index }: SeriesCardProps) {
  return (
    <Link href={`/series/${series.id}`} asChild>
      <Pressable style={styles.wrapper}>
        {/* Card Container */}
        <View style={styles.container}>
          {/* Background Image */}
          <Image
            source={{ uri: series.mainBackdrop.low }}
            style={styles.backgroundImage}
            resizeMode="cover"
          />
          
          {/* Dark Overlay */}
          <View style={styles.overlay} />
          
          {/* Index Badge */}
          <View style={styles.indexBadge}>
            <Text style={styles.indexText}>{index + 1}</Text>
          </View>

          {/* Logo */}
          {series.logos && series.logos[0] && (
            <View style={styles.logoContainer}>
              <Image
                source={{ uri: series.logos[0].low }}
                style={styles.logo}
                resizeMode="contain"
              />
            </View>
          )}
        </View>

        {/* Content Below Card */}
        <View style={styles.contentBelow}>
          <Text style={styles.title} numberOfLines={1}>
            {series.title}
          </Text>
          <View style={styles.metaInfo}>
            <Text style={styles.genre} numberOfLines={1}>
              {series.genres}
            </Text>
            <View style={styles.ratingBadge}>
              <Ionicons name="star" size={12} color="#FFD700" />
              <Text style={styles.rating}>{series.rating}</Text>
            </View>
          </View>
        </View>
      </Pressable>
    </Link>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    width: CARD_WIDTH,
    marginRight: 16,
  },
  container: {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    borderRadius: 12,
    overflow: "hidden",
    backgroundColor: "#1a1a1a",
    position: "relative",
    marginBottom: 8,
  },
  backgroundImage: {
    width: "100%",
    height: "100%",
    position: "absolute",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.2)",
  },
  logoContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  logo: {
    width: "85%",
    height: "50%",
  },
  contentBelow: {
    paddingHorizontal: 4,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 14,
    fontWeight: "600",
    marginBottom: 4,
  },
  metaInfo: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  genre: {
    color: "#999",
    fontSize: 12,
    flex: 1,
    marginRight: 8,
  },
  ratingBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.1)",
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 6,
  },
  rating: {
    color: "#FFD700",
    fontSize: 12,
    fontWeight: "600",
    marginLeft: 4,
  },
  indexBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    zIndex: 2,
    backgroundColor: "rgba(0, 0, 0, 0.75)",
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 2,
    borderColor: "#FFD700",
  },
  indexText: {
    color: "#FFD700",
    fontSize: 14,
    fontWeight: "600",
  },
});
