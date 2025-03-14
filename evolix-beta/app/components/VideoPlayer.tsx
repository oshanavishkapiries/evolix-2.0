import React, { useState } from 'react';
import { View, StyleSheet, ActivityIndicator } from 'react-native';
import WebView from 'react-native-webview';

interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string;
  title?: string;
  posterUrl?: string;
  headers?: any;
}

export function VideoPlayer({ 
  videoUrl, 
  subtitleUrl,
  title = "Video Player",
  posterUrl,
  headers 
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(true);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link href="https://releases.flowplayer.org/7.2.7/skin/skin.css" rel="stylesheet">
        <script src="https://releases.flowplayer.org/7.2.7/flowplayer.min.js"></script>
        <script src="https://releases.flowplayer.org/hlsjs/flowplayer.hlsjs.min.js"></script>
        <style>
            html, body { 
                margin: 0; 
                padding: 0;
                width: 100%;
                height: 100%;
                background: #000; 
                overflow: hidden;
            }
            .flowplayer {
                width: 100%;
                height: 100%;
                background-color: #000;
            }
            .fp-player {
                background-color: #000;
            }
            #player {
                width: 100%;
                height: 100%;
            }
            .fp-subtitle {
                color: white;
                text-shadow: -1px -1px 0 #000, 1px -1px 0 #000, -1px 1px 0 #000, 1px 1px 0 #000;
                font-size: 20px;
                font-family: Arial, sans-serif;
                bottom: 50px;
            }
        </style>
    </head>
    <body>
        <div id="player"></div>

        <script>
            window.onload = function() {
                flowplayer('#player', {
                    clip: {
                        sources: [{
                            type: ${videoUrl.includes('.m3u8') ? '"application/x-mpegurl"' : '"video/mp4"'},
                            src: "${videoUrl}"
                        }],
                        title: "${title}",
                        ${posterUrl ? `poster: "${posterUrl}",` : ''}
                        ${subtitleUrl ? `
                        tracks: [{
                            kind: "subtitles",
                            label: "Subtitles",
                            src: "${subtitleUrl}",
                            srclang: "en",
                            default: true
                        }],` : ''}
                    },
                    subtitle: {
                        defaultTrack: 0,
                        fontSize: '20px'
                    },
                    autoplay: false,
                    muted: false,
                    native_fullscreen: true,
                    fullscreen: true,
                    keyboard: true,
                    share: false,
                    ratio: 9/16,
                    adaptiveRatio: true,
                    hlsjs: {
                        xhrSetup: function(xhr, url) {
                            ${headers ? `
                            Object.keys(${JSON.stringify(headers)}).forEach(function(key) {
                                xhr.setRequestHeader(key, ${JSON.stringify(headers)}[key]);
                            });
                            ` : ''}
                        }
                    }
                }).on("ready", function(e, api) {
                    console.log("Player is ready");
                    if (api.subtitles) {
                        api.subtitles.show();
                    }
                }).on("error", function(e, api, err) {
                    console.error("Player error:", err);
                });
            };
        </script>
    </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        source={{ 
          html: htmlContent,
          headers: headers 
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
  webview: {
    flex: 1,
    backgroundColor: 'black',
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'black',
  }
});