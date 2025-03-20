import React, { useState, useEffect } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import WebView from 'react-native-webview';
import * as ScreenOrientation from 'expo-screen-orientation';
import { WatchHistoryService } from '../services/watchHistory';
import { WatchHistoryItem } from '../types/watchHistory';

interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string;
  title?: string;
  posterUrl?: string;
  headers?: any;
  episodeId?: string;
  seriesId?: string;
  seriesTitle?: string;
  episodeTitle?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  thumbnailUrl?: string;
  initialTimestamp?: number;
}

export function VideoPlayer({
  videoUrl,
  subtitleUrl,
  title = "Video Player",
  posterUrl,
  headers,
  episodeId,
  seriesId,
  seriesTitle,
  episodeTitle,
  episodeNumber,
  seasonNumber,
  thumbnailUrl,
  initialTimestamp = 0
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [subtitleContent, setSubtitleContent] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(initialTimestamp);

  console.log('====================================');
  console.log('initialTimestamp', initialTimestamp);
  console.log('====================================');

  useEffect(() => {
    async function fetchSubtitles() {
      if (subtitleUrl) {
        try {
          const response = await fetch(subtitleUrl, {
            headers: headers || {},
          });
          const text = await response.text();
          setSubtitleContent(text);
        } catch (error) {
          console.warn('Error fetching subtitles:', error);
          setSubtitleContent(null);
        }
      }
    }

    fetchSubtitles();
  }, [subtitleUrl, headers]);

  useEffect(() => {
    async function changeOrientation() {
      try {
        if (isFullscreen) {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.LANDSCAPE
          );
        } else {
          await ScreenOrientation.lockAsync(
            ScreenOrientation.OrientationLock.PORTRAIT_UP
          );
        }
      } catch (error) {
        console.warn('Error changing orientation:', error);
      }
    }

    changeOrientation();

    return () => {
      ScreenOrientation.unlockAsync().catch((error) =>
        console.warn('Error unlocking orientation:', error)
      );
    };
  }, [isFullscreen]);

  const injectedJavaScript = `
    document.addEventListener('fullscreenchange', function() {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          event: 'fullscreen',
          isFullscreen: !!document.fullscreenElement
        })
      );
    });
    document.addEventListener('webkitfullscreenchange', function() {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          event: 'fullscreen',
          isFullscreen: !!document.webkitFullscreenElement
        })
      );
    });

    // Add timeupdate event listener
    document.getElementById('my-video').addEventListener('timeupdate', function() {
      window.ReactNativeWebView.postMessage(
        JSON.stringify({
          event: 'timeupdate',
          currentTime: this.currentTime
        })
      );
    });

    true;
  `;

  const encodeToBase64 = (text: string) => {
    try {
      return btoa(unescape(encodeURIComponent(text)));
    } catch (error) {
      console.warn('Error encoding to base64:', error);
      return '';
    }
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link href="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.css" rel="stylesheet">
        <script src="https://cdn.fluidplayer.com/v3/current/fluidplayer.min.js"></script>
        <style>
            html, body { 
                margin: 0; 
                padding: 0;
                width: 100%;
                height: 100%;
                background: #000; 
                overflow: hidden;
                position: fixed;
            }
            .fluid_video_wrapper {
                width: 100% !important;
                height: 100% !important;
                position: absolute !important;
                top: 0;
                left: 0;
                background: #000;
            }
            #my-video {
                width: 100%;
                height: 100%;
                position: absolute;
                top: 0;
                left: 0;
                object-fit: contain;
            }
        </style>
    </head>
    <body>
        <div id="video-container">
            <video id="my-video" preload="auto" ${initialTimestamp > 0 ? `data-start-time="${initialTimestamp}"` : ''}>
                <source src="${videoUrl}" type="${videoUrl.includes('.m3u8') ? 'application/x-mpegurl' : 'video/mp4'}" />
                ${subtitleContent
      ? `<track src="data:text/vtt;base64,${encodeToBase64(
        subtitleContent
      )}" kind="metadata" srclang="en" label="sinhala" default>`
      : ''
    }
            </video>
        </div>

        <script>
            window.onload = function() {
                var videoElement = document.getElementById('my-video');
                var startTime = videoElement.getAttribute('data-start-time');
                
                if (startTime) {
                    videoElement.currentTime = parseFloat(startTime);
                }

                var player = fluidPlayer('my-video', {
                    layoutControls: {
                        primaryColor: "#FFD700",
                        fillToContainer: true,
                        posterImage: "${posterUrl || ''}",
                        playButtonShowing: true,
                        playPauseAnimation: true,
                        autoPlay: true,
                        mute: false,
                        keyboardControl: true,
                        layout: 'default',
                        allowDownload: false,
                        playbackRateEnabled: false,
                        subtitlesEnabled: true,
                        allowTheatre: false,
                        loop: false,
                        controlForwardBackward: {
                            show: true,
                            skipSeconds: 10
                        }
                    }
                });
            };
        </script>
    </body>
    </html>
  `;

  const onMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);

      if (data.event === 'fullscreen') {
        setIsFullscreen(data.isFullscreen);
      } else if (data.event === 'timeupdate' && episodeId) {
        const newTime = Math.floor(data.currentTime);
        if (newTime !== currentTime) {
          setCurrentTime(newTime);
          await WatchHistoryService.updateWatchTimestamp(episodeId, newTime);
        }
      }
    } catch (error) {
      console.warn('Error parsing WebView message:', error);
    }
  };

  useEffect(() => {
    if (episodeId && seriesId && seriesTitle && episodeTitle && episodeNumber && seasonNumber) {
      const watchHistoryItem: WatchHistoryItem = {
        id: `${seriesId}-${episodeId}`,
        seriesId,
        seriesTitle,
        episodeId,
        episodeTitle,
        episodeNumber,
        seasonNumber,
        timestamp: currentTime,
        lastWatchedAt: Date.now(),
        thumbnailUrl,
        provider: videoUrl.split('/')[2],
        videoUrl,
        subtitleUrl: subtitleUrl || ''
      };
      WatchHistoryService.addToWatchHistory(watchHistoryItem);
    }
  }, [episodeId, seriesId, seriesTitle, episodeTitle, episodeNumber, seasonNumber, currentTime, thumbnailUrl, videoUrl, subtitleUrl]);

  return (
    <View style={[styles.container, isFullscreen && styles.fullscreen]}>
      <WebView
        source={{
          html: htmlContent,
          headers: headers,
        }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        allowsFullscreenVideo={true}
        mediaPlaybackRequiresUserAction={false}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={['*']}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.warn('WebView error:', nativeEvent);
        }}
        onMessage={onMessage}
        injectedJavaScript={injectedJavaScript}
        scrollEnabled={false}
        bounces={false}
        userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
      />
      {loading && (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color="#FFD700" />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  fullscreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 9999,
  },
  webview: {
    flex: 1,
    backgroundColor: 'black',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  },
});