import React from 'react';
import { WebView } from 'react-native-webview';
import { StyleSheet } from 'react-native';

interface VideoPlayerProps {
  videoUrl: string;
  subtitleUrl?: string;
}

export function VideoPlayer({ videoUrl, subtitleUrl }: VideoPlayerProps) {
  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <link href="https://vjs.zencdn.net/8.10.0/video-js.css" rel="stylesheet" />
        <script src="https://vjs.zencdn.net/8.10.0/video.min.js"></script>
        <style>
          body { margin: 0; background: #000; height: 100vh; }
          .video-container { width: 100%; height: 100%; }
          .video-js { width: 100%; height: 100%; }
        </style>
      </head>
      <body>
        <div class="video-container">
          <video
            id="my-video"
            class="video-js"
            controls
            preload="auto"
          >
            <source src="${videoUrl}" type="video/mp4" />
            ${subtitleUrl ? `<track kind="subtitles" src="${subtitleUrl}" srclang="en" label="English" default>` : ''}
          </video>
        </div>
        <script>
          var player = videojs('my-video');
          player.play();
        </script>
      </body>
    </html>
  `;

  return (
    <WebView
      source={{ 
        html: htmlContent,
        headers: {
          'Referer': 'https://mixdrop.ps',
          'Origin': 'https://mixdrop.ps'
        }
      }}
      style={styles.webview}
      javaScriptEnabled={true}
      domStorageEnabled={true}
      allowsInlineMediaPlayback={true}
      mediaPlaybackRequiresUserAction={false}
      allowsFullscreenVideo={true}
      userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
    />
  );
}

const styles = StyleSheet.create({
  webview: {
    flex: 1,
  },
}); 