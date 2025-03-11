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
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
        <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
        <script src="https://cdn.jsdelivr.net/npm/@videojs/http-streaming@3.10.0/dist/videojs-http-streaming.min.js"></script>
        <style>
            body { 
                margin: 0; 
                background: #000; 
                overflow: hidden;
            }
            .container {
                width: 100vw;
                height: 100vh;
                display: flex;
                align-items: center;
                justify-content: center;
            }
            .video-js {
                width: 100%;
                height: 100%;
            }
            .vjs-theme-custom {
                --vjs-theme-primary: #FFD700;
                --vjs-theme-secondary: #fff;
            }
            .video-js .vjs-control-bar {
                background-color: rgba(0, 0, 0, 0.7);
            }
            .video-js .vjs-slider {
                background-color: rgba(255, 215, 0, 0.3);
            }
            .video-js .vjs-play-progress {
                background-color: #FFD700;
            }
            .video-js .vjs-big-play-button {
                background-color: rgba(0, 0, 0, 0.6);
                border-color: #FFD700;
            }
            .video-js:hover .vjs-big-play-button {
                background-color: rgba(0, 0, 0, 0.8);
            }
            .video-js .vjs-volume-level {
                background-color: #FFD700;
            }
            .video-js .vjs-loading-spinner {
                border-color: #FFD700;
            }
        </style>
    </head>
    <body>
        <div class="container">
            <video-js id="player" 
                class="video-js vjs-theme-custom vjs-big-play-centered vjs-fluid"
                controls
                preload="auto"
                playsinline>
            </video-js>
        </div>

        <script>
            document.addEventListener('DOMContentLoaded', function() {
                const player = videojs('player', {
                    controls: true,
                    fluid: true,
                    html5: {
                        vhs: {
                            overrideNative: true,
                            fastPlayThreshold: 10,
                            bandwidth: 5000000,
                            maxBufferLength: 30,
                            maxMaxBufferLength: 600,
                            maxBufferSize: 60 * 1000 * 1000,
                            maxBufferHole: 0.5,
                            lowLatencyMode: true,
                            backBufferLength: 90,
                            enableLowLatencyMode: true,
                            smoothQualityChange: true,
                            handleManifestRedirects: true,
                            allowSeeksWithinUnsafeLiveWindow: true,
                            experimentalBufferBasedABR: true,
                            useBandwidthFromLocalStorage: true,
                            useDevicePixelRatio: true,
                            handlePartialData: true,
                            progressive: true,
                            testBandwidth: true,
                            startLevel: -1,
                            abrEwmaDefaultEstimate: 500000,
                            abrBandWidthFactor: 0.95,
                            abrBandWidthUpFactor: 0.7,
                            abrMaxWithRealBitrate: true,
                            maxStarvationDelay: 4,
                            maxLoadingDelay: 4,
                            manifestLoadTime: 10000,
                            manifestLoadPolicy: {
                                default: {
                                    maxTimeToFirstByteMs: 10000,
                                    maxLoadTimeMs: 20000,
                                    timeoutRetry: {
                                        maxNumRetry: 6,
                                        retryDelayMs: 1000,
                                        maxRetryDelayMs: 8000
                                    },
                                    errorRetry: {
                                        maxNumRetry: 6,
                                        retryDelayMs: 1000,
                                        maxRetryDelayMs: 8000
                                    }
                                }
                            },
                            segmentLoadTime: 10000,
                            segmentLoadPolicy: {
                                default: {
                                    maxTimeToFirstByteMs: 10000,
                                    maxLoadTimeMs: 20000,
                                    timeoutRetry: {
                                        maxNumRetry: 6,
                                        retryDelayMs: 1000,
                                        maxRetryDelayMs: 8000
                                    },
                                    errorRetry: {
                                        maxNumRetry: 6,
                                        retryDelayMs: 1000,
                                        maxRetryDelayMs: 8000
                                    }
                                }
                            }
                        },
                        nativeAudioTracks: false,
                        nativeVideoTracks: false
                    },
                    playbackRates: [0.5, 1, 1.25, 1.5, 2],
                    controlBar: {
                        children: [
                            'playToggle',
                            'volumePanel',
                            'currentTimeDisplay',
                            'timeDivider',
                            'durationDisplay',
                            'progressControl',
                            'playbackRateMenuButton',
                            'subtitlesButton',
                            'captionsButton',
                            'qualitySelector',
                            'fullscreenToggle'
                        ]
                    },
                    sources: [{
                        src: '${"https://cdn.fluidplayer.com/videos/valerian-480p.mkv"}',
                        type: 'application/x-mpegURL'
                    }],
                    poster: '${posterUrl || ''}',
                });

                // Add subtitle if provided
                ${subtitleUrl ? `
                player.ready(function() {
                    this.addRemoteTextTrack({
                        kind: 'subtitles',
                        srclang: 'en',
                        label: 'Subtitles',
                        src: '${subtitleUrl}',
                        default: true
                    }, false);
                });
                ` : ''}

                // Handle errors
                player.on('error', function() {
                    console.log('Player error:', player.error());
                });

                // Handle ready state
                player.on('ready', function() {
                    console.log('Player is ready');
                });

                // Handle play/pause
                player.on('play', function() {
                    console.log('Video started playing');
                });

                player.on('pause', function() {
                    console.log('Video paused');
                });

                // Handle quality changes
                player.on('playing', function() {
                    const currentQuality = player.qualityLevels().selectedIndex;
                    console.log('Current quality:', currentQuality);
                });

                // Handle buffering
                player.on('waiting', function() {
                    console.log('Buffering...');
                });

                player.on('canplay', function() {
                    console.log('Can play');
                });
            });
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