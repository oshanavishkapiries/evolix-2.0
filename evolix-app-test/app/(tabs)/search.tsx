import React, { useState } from "react";
import {
  View,
  TextInput,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  Text,
  Image,
  Pressable,
} from "react-native";
import { Link, router, Stack } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons, MaterialCommunityIcons } from "@expo/vector-icons";
import { useDebounce } from "../hooks/useDebounce";
import { TVSeries } from "../types/api";
import { searchTVSeries } from "../services/api";

export default function SearchScreen() {
  const [series, setSeries] = useState<TVSeries[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
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
      setError("");

      const response = await searchTVSeries(debouncedSearch);

      if (response.success) {
        setSeries(response.data.results);
      } else {
        setError(response.message || "Failed to search TV series");
      }
    } catch (err) {
      console.error("Error searching TV series:", err);
      setError("An unexpected error occurred while searching");
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
          <Text style={styles.title} numberOfLines={2}>
            {item.title}
          </Text>
          <View style={styles.metaInfo}>
            <Text style={styles.year}>{item.year}</Text>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Text style={styles.rating}>{item.rating}</Text>
            </View>
          </View>
          <Text style={styles.genres} numberOfLines={1}>
            {item.genres}
          </Text>
        </View>
      </Pressable>
    </Link>
  );

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: false,
        }}
      />
      <View style={[styles.container, { paddingTop: insets.top }]}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>Search</Text>
        </View>

        <View style={styles.searchContainer}>
          <View style={styles.searchInputContainer}>
            <Ionicons
              name="search-outline"
              size={20}
              color="#666"
              style={styles.searchIcon}
            />
            <TextInput
              style={styles.searchInput}
              placeholder="Search TV Series..."
              placeholderTextColor="#666"
              value={searchQuery}
              onChangeText={setSearchQuery}
              returnKeyType="search"
            />
            {searchQuery.length > 0 && (
              <Pressable
                onPress={() => setSearchQuery("")}
                style={styles.clearButton}
              >
                <Ionicons name="close-circle" size={20} color="#666" />
              </Pressable>
            )}
          </View>
        </View>

        {error ? (
          <View style={styles.errorContainer}>
            <MaterialCommunityIcons
              name="alert-circle-outline"
              size={24}
              color="#ff6b6b"
            />
            <Text style={styles.error}>{error}</Text>
          </View>
        ) : loading ? (
          <ActivityIndicator
            size="large"
            color="#ffd700"
            style={styles.loader}
          />
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
            <MaterialCommunityIcons
              name="movie-search"
              size={64}
              color="#666"
            />
            <Text style={styles.noResults}>No results found</Text>
            <Text style={styles.noResultsSubtext}>
              Try different keywords or check the spelling
            </Text>
          </View>
        ) : (
          <View style={styles.emptyState}>
            <MaterialCommunityIcons
              name="movie-search"
              size={64}
              color="#666"
            />
            <Text style={styles.placeholder}>Find Your Next Favorite Show</Text>
            <Text style={styles.placeholderSubtext}>
              Search by title, actor, or genre
            </Text>
          </View>
        )}
      </View>
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
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: "#000000",
  },
  headerTitle: {
    color: "#FFFFFF",
    fontSize: 24,
    fontWeight: "600",
    flex: 1,
    textAlign: "center",
  },
  searchContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#000000",
    borderBottomWidth: 1,
    borderBottomColor: "#222",
  },
  searchInputContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#333",
    height: 50,
  },
  searchIcon: {
    marginLeft: 16,
  },
  searchInput: {
    flex: 1,
    color: "#ffffff",
    fontSize: 16,
    paddingLeft: 12,
    paddingRight: 40,
  },
  clearButton: {
    padding: 8,
    marginRight: 8,
  },
  list: {
    padding: 16,
  },
  listItem: {
    flexDirection: "row",
    marginBottom: 16,
    backgroundColor: "#1a1a1a",
    borderRadius: 12,
    overflow: "hidden",
    elevation: 3,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  poster: {
    width: 100,
    height: 150,
    backgroundColor: "#111",
  },
  itemInfo: {
    flex: 1,
    padding: 14,
    justifyContent: "space-between",
  },
  title: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 8,
    lineHeight: 22,
  },
  metaInfo: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 8,
  },
  year: {
    color: "#999",
    fontSize: 14,
    marginRight: 12,
  },
  ratingContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 215, 0, 0.1)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
  },
  rating: {
    color: "#FFD700",
    fontSize: 14,
    marginLeft: 4,
    fontWeight: "600",
  },
  genres: {
    color: "#999",
    fontSize: 13,
    lineHeight: 18,
  },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  errorContainer: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255, 107, 107, 0.1)",
    margin: 16,
    padding: 16,
    borderRadius: 12,
    gap: 12,
  },
  error: {
    color: "#ff6b6b",
    fontSize: 15,
    flex: 1,
  },
  emptyState: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 16,
  },
  noResults: {
    color: "#fff",
    textAlign: "center",
    marginTop: 16,
    fontSize: 18,
    fontWeight: "600",
  },
  noResultsSubtext: {
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    fontSize: 14,
  },
  placeholder: {
    color: "#fff",
    textAlign: "center",
    marginTop: 16,
    fontSize: 20,
    fontWeight: "600",
  },
  placeholderSubtext: {
    color: "#666",
    textAlign: "center",
    marginTop: 8,
    fontSize: 14,
    maxWidth: 240,
    lineHeight: 20,
  },
});
