import React, { useState } from "react";
import {
  View,
  StyleSheet,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { VideoPlayer } from "../components/VideoPlayer";

type ParamsFromURL = {
  videoUrl?: string;
  subtitleUrl?: string;
  posterUrl?: string;
  title?: string;
  headers?: string;
  episodeId?: string;
  seriesId?: string;
  seriesTitle?: string;
  episodeTitle?: string;
  episodeNumber?: string;
  seasonNumber?: string;
  thumbnailUrl?: string;
  initialTimestamp?: string;
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
          title={params.title || ""}
          subtitleUrl={params.subtitleUrl || ""}
          posterUrl={params.posterUrl || ""}
          headers={headers}
          episodeId={params.episodeId}
          seriesId={params.seriesId}
          seriesTitle={params.seriesTitle}
          episodeTitle={params.episodeTitle}
          episodeNumber={params.episodeNumber ? parseInt(params.episodeNumber) : undefined}
          seasonNumber={params.seasonNumber ? parseInt(params.seasonNumber) : undefined}
          thumbnailUrl={params.thumbnailUrl}
          initialTimestamp={params.initialTimestamp ? parseInt(params.initialTimestamp) : 0}
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
