import React from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { getVideoExtractorConfig } from '../hooks/useVideoExtractor';
import { getSubtitleExtractorConfig } from '../hooks/useSubtitleExtractor';

interface HiddenExtractorsProps {
  videoUrl?: string;
  subtitleUrl?: string;
  onVideoMessage: (event: any) => void;
  onSubtitleMessage: (event: any) => void;
  onVideoError: () => void;
  onSubtitleError: () => void;
}

export default function HiddenExtractors({
  videoUrl,
  subtitleUrl,
  onVideoMessage,
  onSubtitleMessage,
  onVideoError,
  onSubtitleError,
}: HiddenExtractorsProps) {
  return (
    <View style={styles.container}>
      {videoUrl && (
        <WebView
          {...getVideoExtractorConfig(videoUrl)}
          style={styles.hiddenWebView}
          onError={onVideoError}
          onMessage={onVideoMessage}
        />
      )}
      {subtitleUrl && (
        <WebView
          {...getSubtitleExtractorConfig(subtitleUrl)}
          style={styles.hiddenWebView}
          onError={onSubtitleError}
          onMessage={onSubtitleMessage}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    width: 0,
    height: 0,
    opacity: 0,
  },
  hiddenWebView: {
    width: 0,
    height: 0,
  },
}); 