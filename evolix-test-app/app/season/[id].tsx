import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Image,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, Link, Stack } from "expo-router";
import { getSeasonEpisodes } from "../services/api";
import { Season, Episode } from "../types/api";

export default function SeasonDetailsScreen() {
  const { id } = useLocalSearchParams();
  const [seasonData, setSeasonData] = useState<
    (Season & { episodes: Episode[] }) | null
  >(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    loadSeasonDetails();
  }, [id]);

  const loadSeasonDetails = async () => {
    try {
      setLoading(true);
      setError("");

      const response = await getSeasonEpisodes(id as string);

      if (response.success) {
        setSeasonData(response.data);
      } else {
        setError("Failed to load season details");
      }
    } catch (err) {
      setError("An error occurred while loading season details");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <ActivityIndicator size="large" color="#0000ff" style={styles.loader} />
    );
  }

  if (error || !seasonData) {
    return <Text style={styles.error}>{error || "Season not found"}</Text>;
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: seasonData.name,
          headerShown: true,
          headerStyle: { backgroundColor: "#000000" },
          headerTintColor: "#ffffff",
        }}
      />
      <ScrollView style={styles.container}>
        <View style={styles.header}>
          <Image
            source={{ uri: seasonData.poster.high }}
            style={styles.poster}
            resizeMode="cover"
          />
          <View style={styles.info}>
            <Text style={styles.title}>{seasonData.name}</Text>
            <Text style={styles.metadata}>
              {seasonData.episodeCount} Episodes •{" "}
              {new Date(seasonData.airDate).getFullYear()}
            </Text>
            <Text style={styles.overview} numberOfLines={3}>
              {seasonData.overview}
            </Text>
          </View>
        </View>

        <View style={styles.episodeList}>
          <Text style={styles.sectionTitle}>Episodes</Text>
          {seasonData.episodes.map((episode) => (
            <Link
              key={episode._id}
              href={{
                pathname: "/extract/[provider]",
                params: {
                  provider: episode?.stream?.provider,
                  videoUrl: episode.stream.video_link,
                  subtitleUrl: episode.stream.subtitle_link,
                  posterUrl: episode.poster.high,
                  title: episode.name,
                },
              }}
              asChild
            >
              <TouchableOpacity style={styles.episodeCard}>
                <Image
                  source={{ uri: episode.poster.low }}
                  style={styles.episodePoster}
                  resizeMode="cover"
                />
                <View style={styles.episodeInfo}>
                  <Text style={styles.episodeTitle}>
                    {episode.episodeNumber}. {episode.name}
                  </Text>
                  <Text style={styles.episodeOverview} numberOfLines={2}>
                    {episode.overview}
                  </Text>
                  <View style={styles.episodeMetadata}>
                    <Text style={styles.episodeRating}>
                      ⭐ {episode.rating}
                    </Text>
                    <Text style={styles.episodeAirDate}>
                      {new Date(episode.airDate).toLocaleDateString()}
                    </Text>
                  </View>
                </View>
              </TouchableOpacity>
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
  header: {
    flexDirection: "row",
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: "#333",
  },
  poster: {
    width: 120,
    height: 180,
    borderRadius: 8,
  },
  info: {
    flex: 1,
    marginLeft: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 8,
  },
  metadata: {
    fontSize: 16,
    color: "#888888",
    marginBottom: 8,
  },
  overview: {
    fontSize: 14,
    color: "#ffffff",
    lineHeight: 20,
  },
  episodeList: {
    padding: 16,
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 16,
  },
  episodeCard: {
    flexDirection: "row",
    backgroundColor: "#1a1a1a",
    borderRadius: 8,
    marginBottom: 12,
    overflow: "hidden",
  },
  episodePoster: {
    width: 120,
    height: "auto",
  },
  episodeInfo: {
    flex: 1,
    padding: 12,
  },
  episodeTitle: {
    fontSize: 16,
    fontWeight: "bold",
    color: "#ffffff",
    marginBottom: 4,
  },
  episodeOverview: {
    fontSize: 14,
    color: "#888888",
    marginBottom: 8,
  },
  episodeMetadata: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  episodeRating: {
    fontSize: 14,
    color: "#ffd700",
  },
  episodeAirDate: {
    fontSize: 14,
    color: "#666666",
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
