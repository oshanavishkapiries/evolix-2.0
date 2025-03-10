import React, { useState } from "react";
import {
  View,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { VideoPlayer } from "./components/VideoPlayer";

type ParamsFromURL = {
  videoUrl?: string;
  subtitleUrl?: string;
  posterUrl?: string;
  title?: string;
  headers?: string;
}

interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string;
  headers?: Record<string, string>;
}

export default function PlayerScreen() {
  const params = useLocalSearchParams<ParamsFromURL>();
  const headers = params.headers ? JSON.parse(params.headers) : undefined;

  return (
    <>
      <Stack.Screen
        options={{
          title: params.title || "Player",
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#ffffff',
        }}
      />
      <View style={styles.container}>
        <VideoPlayer
          videoUrl={params.videoUrl || ""}
          subtitleUrl={params.subtitleUrl || ""}
          posterUrl={params.posterUrl || ""}
          headers={headers}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000000",
  }
});
