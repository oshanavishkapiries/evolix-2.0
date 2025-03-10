import { useEffect, useState } from "react";
import { View, ActivityIndicator, StyleSheet, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import {
  getMetadata,
  getSubtitleExtractorScript,
  getVideoExtractorScript,
} from "../services/extractors";
import { WebView } from "react-native-webview";
import React from "react";

export default function ExtractPage() {
  const router = useRouter();
  const { provider, videoUrl, subtitleUrl, posterUrl, title } =
    useLocalSearchParams<{
      provider: string;
      videoUrl: string;
      subtitleUrl: string;
      posterUrl: string;
      title: string;
    }>();

  const [error, setError] = useState<string | null>(null);
  const [extractedVideoUrl, setExtractedVideoUrl] = useState<string | null>(
    null
  );
  const [extractedSubtitleUrl, setExtractedSubtitleUrl] = useState<
    string | null
  >(null);

  const [metadata, setMetadata] = useState<any>(null);
  const [videoScript, setVideoScript] = useState<string | null>(null);
  const [subtitleScript, setSubtitleScript] = useState<string | null>(null);
  const [message, setMessage] = useState<string>(
    "connecting to evolix server..."
  );
  const [counter, setCounter] = useState<number>(0);

  useEffect(() => {
    async function extract() {
      try {
        const metadata = await getMetadata(provider);
        setMetadata(metadata);

        const videoScript = await getVideoExtractorScript(provider);
        setVideoScript(videoScript);

        const subtitleScript = await getSubtitleExtractorScript(provider);
        setSubtitleScript(subtitleScript);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to extract media"
        );
      }
    }

    extract();
  }, [provider, router]);

  useEffect(() => {
    if (extractedVideoUrl && extractedSubtitleUrl) {
      setTimeout(() => {
      router.replace({
        pathname: "/player",
        params: {
          videoUrl: extractedVideoUrl,
          subtitleUrl: extractedSubtitleUrl,
          posterUrl,
          title,
          headers: JSON.stringify({
            Referer: metadata?.Referer,
            Origin: metadata?.Origin,
          }),
        },
        });
      }, 1000);
    }
  }, [extractedVideoUrl, extractedSubtitleUrl, router, metadata]);

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      console.log("Received data from WebView:", data);

      if (counter === 0) {
        setMessage("server connected ⚡");
      }

      if (counter === 2) {
        setMessage("be patient... ");
      }

      if (counter === 4) {
        setMessage("almost done... ");
      }

      setCounter(counter + 1);

      if (data.type === "videoUrl") {
        setMessage("stream ready...");
        setExtractedVideoUrl(data.url);
      }

      if (data.type === "subtitleUrl") {
        setMessage("subtitles ready...");
        setExtractedSubtitleUrl(data.url);
      }

      if (data.type === "error") {
        setError("sorry, something went wrong");
      }
    } catch (error) {
      console.error("Error processing WebView message:", error);
      setError("Failed to process extracted data");
    }
  };

  const handleError = (event: any) => {
    console.error("WebView error:", event.nativeEvent.error);
    setError("Failed to extract media URL");
  };

  if (error) {
    return (
      <View style={styles.container}>
        <Text style={styles.error}>{error}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen
        options={{
          title: "",
          headerStyle: { backgroundColor: "#000000" },
          headerTintColor: "#ffffff",
        }}
      />
      <View style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator color="#ffff00" size="large" />
          <Text style={styles.text}>{message}</Text>
        </View>

        <View style={styles.hiddenContainer}>
          {videoScript && !extractedVideoUrl && (
            <WebView
              style={{ width: 0, height: 0, opacity: 0 }}
              javaScriptEnabled={true}
              onMessage={handleMessage}
              onError={handleError}
              source={{
                uri: videoUrl,
              }}
              injectedJavaScript={`
            ${videoScript}
            try {
              const extractedUrl = extractVideo();
              window.ReactNativeWebView.postMessage(JSON.stringify({ videoUrl: extractedUrl }));
            } catch (error) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ error: error.message }));
            }
          `}
              userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            />
          )}

          {subtitleScript && extractedVideoUrl && !extractedSubtitleUrl && (
            <WebView
              style={{ width: 0, height: 0, opacity: 0 }}
              javaScriptEnabled={true}
              onMessage={handleMessage}
              onError={handleError}
              source={{
                uri: subtitleUrl,
              }}
              injectedJavaScript={`
              ${subtitleScript}
              try {
                const extractedUrl = extractSubtitle();
                window.ReactNativeWebView.postMessage(JSON.stringify({ subtitleUrl: extractedUrl }));
              } catch (error) {
                window.ReactNativeWebView.postMessage(JSON.stringify({ error: error.message }));
              }
            `}
              userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            />
          )}
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: 20,
  },
  text: {
    fontSize: 18,
    marginTop: 20,
    color: "#ffffff",
  },
  error: {
    color: "red",
    fontSize: 16,
    textAlign: "center",
  },
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  hiddenContainer: {
    display: "none",
  },
});
