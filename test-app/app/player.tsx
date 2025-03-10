import React, { useState } from "react";
import {
  View,
  TextInput,
  Button,
  StyleSheet,
  ActivityIndicator,
  Text,
} from "react-native";
import { useLocalSearchParams, Stack } from "expo-router";
import { VideoPlayer } from "./components/VideoPlayer";
import { useVideoExtractor } from "./hooks/useVideoExtractor";
import { useSubtitleExtractor } from "./hooks/useSubtitleExtractor";
import HiddenExtractors from "./components/HiddenExtractors";

export default function PlayerScreen() {
  const { videoUrl: initialVideoUrl, subtitleUrl: initialSubtitleUrl } = useLocalSearchParams<{ videoUrl: string; subtitleUrl: string }>();
  const [inputUrl, setInputUrl] = useState(initialVideoUrl || "");
  const [subtitlePageUrl, setSubtitlePageUrl] = useState(initialSubtitleUrl || "");
  const [isPlaying, setIsPlaying] = useState(!!initialVideoUrl);

  const {
    videoUrl,
    subtitleUrl: extractedSubtitleUrl,
    isExtracting: isExtractingVideo,
    error: videoError,
    extractVideo,
    handleMessage: handleVideoMessage,
    handleError: handleVideoError,
  } = useVideoExtractor();

  const {
    subtitleUrl: manualSubtitleUrl,
    isExtracting: isExtractingSubtitle,
    error: subtitleError,
    extractSubtitle,
    handleMessage: handleSubtitleMessage,
    handleError: handleSubtitleError,
  } = useSubtitleExtractor();

  const handleExtract = () => {
    if (inputUrl) {
      extractVideo(inputUrl);
    }
  };

  const handleExtractSubtitle = () => {
    if (subtitlePageUrl) {
      extractSubtitle(subtitlePageUrl);
    }
  };

  const handlePlay = () => {
    if (videoUrl) {
      setIsPlaying(true);
    }
  };

  const finalVideoUrl = videoUrl || initialVideoUrl;
  const finalSubtitleUrl = manualSubtitleUrl || extractedSubtitleUrl || initialSubtitleUrl;
  const error = videoError || subtitleError;
  const isExtracting = isExtractingVideo || isExtractingSubtitle;

  return (
    <>
      <Stack.Screen
        options={{
          title: "Player",
          headerStyle: { backgroundColor: '#000000' },
          headerTintColor: '#ffffff',
        }}
      />
      <View style={styles.container}>
        {!isPlaying ? (
          <View style={styles.inputContainer}>
            <TextInput
              style={styles.input}
              placeholder="Enter video page URL"
              value={inputUrl}
              onChangeText={setInputUrl}
              autoCapitalize="none"
            />
            <Button title="Extract Video" onPress={handleExtract} />

            <TextInput
              style={styles.input}
              placeholder="Enter subtitle page URL (optional)"
              value={subtitlePageUrl}
              onChangeText={setSubtitlePageUrl}
              autoCapitalize="none"
            />
            <Button
              title="Extract Subtitle"
              onPress={handleExtractSubtitle}
              disabled={!subtitlePageUrl}
            />

            {isExtracting && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color="#ffd700" />
                <Text style={styles.loadingText}>
                  {isExtractingVideo
                    ? "Extracting video..."
                    : "Extracting subtitle..."}
                </Text>
              </View>
            )}

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            {finalVideoUrl && (
              <>
                <TextInput
                  style={styles.input}
                  value={finalVideoUrl}
                  placeholder="Video URL"
                  editable={false}
                />
                {finalSubtitleUrl && (
                  <TextInput
                    style={styles.input}
                    value={finalSubtitleUrl}
                    placeholder="Subtitle URL"
                    editable={false}
                  />
                )}
                <Button title="Play" onPress={handlePlay} />
              </>
            )}

            <HiddenExtractors
              videoUrl={isExtractingVideo ? inputUrl : undefined}
              subtitleUrl={isExtractingSubtitle ? subtitlePageUrl : undefined}
              onVideoMessage={handleVideoMessage}
              onSubtitleMessage={handleSubtitleMessage}
              onVideoError={handleVideoError}
              onSubtitleError={handleSubtitleError}
            />
          </View>
        ) : (
          <VideoPlayer videoUrl={finalVideoUrl} subtitleUrl={finalSubtitleUrl} />
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
  inputContainer: {
    padding: 20,
    gap: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: "#333",
    borderRadius: 5,
    padding: 10,
    color: "#ffffff",
    backgroundColor: "#1a1a1a",
  },
  loadingContainer: {
    alignItems: "center",
    marginVertical: 10,
  },
  loadingText: {
    marginTop: 5,
    color: "#888888",
  },
  errorText: {
    color: "#ff0000",
    textAlign: "center",
  },
});
