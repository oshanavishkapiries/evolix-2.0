import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  Image,
  Pressable,
  FlatList,
} from "react-native";
import { Link } from "expo-router";
import { LinearGradient } from "expo-linear-gradient";
import { MaterialIcons } from "@expo/vector-icons";
import { TVSeries } from "../types/api";

const { width } = Dimensions.get("window");

interface FeaturedSliderProps {
  series: TVSeries[];
}

export default function FeaturedSlider({ series }: FeaturedSliderProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const renderItem = ({ item }: { item: TVSeries }) => (
    <View style={styles.slide}>
      <Image
        source={{ uri: item.mainBackdrop.high }}
        style={styles.image}
        resizeMode="cover"
      />
      <LinearGradient
        colors={["rgba(0, 0, 0, 0.95)", "rgba(0, 0, 0, 0.5)", "transparent"]}
        style={styles.gradient}
        start={{ x: 0, y: 1 }}
        end={{ x: 0, y: 0 }}
      />
      <View style={styles.overlay}>
        <View style={styles.content}>
          {item.logos && item.logos[0] ? (
            <Image
              source={{ uri: item.logos[0].low }}
              style={styles.logo}
              resizeMode="contain"
            />
          ) : (
            <Text style={styles.title}>{item.title}</Text>
          )}
          <Link href={`/series/${item.id}`} asChild>
            <Pressable style={styles.button}>
              <MaterialIcons name="play-arrow" size={20} color="#000000" />
              <Text style={styles.buttonText}>Watch Now</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </View>
  );

  const renderDot = (index: number) => (
    <View
      key={index}
      style={[styles.dot, index === activeIndex && styles.activeDot]}
    />
  );

  const handleScroll = (event: any) => {
    const slideSize = event.nativeEvent.layoutMeasurement.width;
    const offset = event.nativeEvent.contentOffset.x;
    const activeIndex = Math.round(offset / slideSize);
    setActiveIndex(activeIndex);
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={series}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onScroll={handleScroll}
        scrollEventThrottle={16}
      />
      <View style={styles.pagination}>
        {series.map((_, index) => renderDot(index))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    height: width * 1.2,
    backgroundColor: "#000",
  },
  slide: {
    width,
    height: "100%",
  },
  image: {
    width: "100%",
    height: "100%",
  },
  headerGradient: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 150,
  },
  gradient: {
    ...StyleSheet.absoluteFillObject,
    height: "100%",
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "transparent",
    justifyContent: "flex-end",
    alignItems: "center",
    paddingBottom: 40,
  },
  content: {
    padding: 20,
    alignItems: "center",
    width: "100%",
    gap: 16,
  },
  logo: {
    height: 60,
    width: width * 0.5,
    marginBottom: 8,
  },
  title: {
    color: "#FFFFFF",
    fontSize: 32,
    fontWeight: "700",
    marginBottom: 8,
    fontFamily: "System",
    textAlign: "center",
  },
  button: {
    backgroundColor: "#FFFFFF",
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 4,
    minWidth: 140,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  },
  buttonText: {
    color: "#000000",
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  pagination: {
    flexDirection: "row",
    position: "absolute",
    bottom: 16,
    alignSelf: "center",
    gap: 6,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255, 255, 255, 0.4)",
  },
  activeDot: {
    backgroundColor: "#FFFFFF",
    width: 20,
  },
});
