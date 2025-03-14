import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, Link, Stack, router } from "expo-router";
import { TouchableOpacity } from "react-native";
import { getTVSeriesDetails, getTVSeriesSeasons } from "../../services/api";
import { TVSeriesDetails, Season } from "../../types/api";

export default function SeriesDetailsScreen() {
  const { id } = useLocalSearchParams();
  const [series, setSeries] = useState<TVSeriesDetails | null>(null);
  const [seasons, setSeasons] = useState<Season[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSeriesDetails();
  }, [id]);

  const loadSeriesDetails = async () => {
    try {
      setLoading(true);
      setError("");

      const [detailsResponse, seasonsResponse] = await Promise.all([
        getTVSeriesDetails(id as string),
        getTVSeriesSeasons(id as string),
      ]);

      if (detailsResponse.success && seasonsResponse.success) {
        setSeries(detailsResponse.data);
        setSeasons(seasonsResponse.data.seasons);
      } else {
        setError("Failed to load series details");
      }
    } catch (err) {
      setError("An error occurred while loading series details");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ActivityIndicator size="large" color="#0000ff" style={styles.loader} />
    );
  }

  if (error || !series) {
    return <Text style={styles.error}>{error || "Series not found"}</Text>;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: series.title,
          headerStyle: { backgroundColor: "#000000" },
          headerTintColor: "#ffffff",
        }}
      />
      <ScrollView style={styles.container}>
        <View style={styles.backdropContainer}>
          <Image
            source={{ uri: series.mainBackdrop.high }}
            style={styles.backdrop}
            resizeMode="cover"
          />
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <Ionicons name="chevron-back" size={20} color="#ffffff" />
          </TouchableOpacity>
        </View>
        <View style={styles.content}>
          <View style={styles.header}>
            <Image
              source={{ uri: series.mainPoster.low }}
              style={styles.poster}
              resizeMode="cover"
            />
            <View style={styles.info}>
              <Text style={styles.title}>{series.title}</Text>
              <Text style={styles.metadata}>
                {series.year} • ⭐ {series.rating}
              </Text>
              <Text style={styles.genres}>{series.genres}</Text>
            </View>
          </View>

          <Text style={styles.overview}>{series.overview}</Text>

          <Text style={styles.sectionTitle}>Seasons</Text>
          {seasons.map((season) => (
            <Link key={season.id} href={`/season/${season.id}`} asChild>
              <Pressable style={styles.seasonCard}>
                <Image
                  source={{ uri: season.poster.low }}
                  style={styles.seasonPoster}
                  resizeMode="cover"
                />
                <View style={styles.seasonInfo}>
                  <Text style={styles.seasonTitle}>{season.name}</Text>
                  <Text style={styles.episodeCount}>
                    {season.episodeCount} episodes
                  </Text>
                </View>
                <View style={styles.arrowContainer}>
                  <Ionicons name="chevron-forward" size={24} color="#666666" />
                </View>
              </Pressable>
            </Link>
          ))}
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  },
  backdropContainer: {
    position: "relative",
  },
  backdrop: {
    width: "100%",
    height: 250,
  },
  backButton: {
    position: "absolute",
    top: 40,
    left: 16,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    padding: 16,
  },
  header: {
    flexDirection: "row",
    marginTop: -50,
  },
  poster: {
    width: 100,
    height: 150,
    borderRadius: 8,
  },
  info: {
    flex: 1,
    marginLeft: 16,
    justifyContent: "flex-end",
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 4,
  },
  metadata: {
    fontSize: 16,
    color: "#888888",
    marginBottom: 4,
  },
  genres: {
    fontSize: 14,
    color: "#666666",
  },
  overview: {
    fontSize: 16,
    color: "#ffffff",
    marginVertical: 16,
    lineHeight: 24,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 16,
  },
  seasonCard: {
    flexDirection: "row",
    backgroundColor: "#111111",
    borderRadius: 12,
    marginBottom: 12,
    overflow: "hidden",
    alignItems: "center",
    height: 180,
  },
  seasonPoster: {
    width: 120,
    height: "100%",
  },
  seasonInfo: {
    flex: 1,
    padding: 12,
    justifyContent: "center",
  },
  seasonTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  episodeCount: {
    fontSize: 14,
    color: "#666666",
  },
  arrowContainer: {
    paddingRight: 12,
    justifyContent: "center",
    alignItems: "center",
  },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  error: {
    color: "#ff0000",
    textAlign: "center",
    margin: 16,
  },
});
