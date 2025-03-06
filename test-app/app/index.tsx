import React, { useState } from 'react';
import { View, TextInput, Button, StyleSheet, Text, ActivityIndicator } from 'react-native';
import { WebView } from 'react-native-webview';
import { videoExtractorScript } from './utils/videoExtractor';

export default function HomeScreen() {
  const [url, setUrl] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [videoUrl, setVideoUrl] = useState('');
  const [error, setError] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);

  const handleUrlSubmit = () => {
    if (url) {
      setIsLoading(true);
      setVideoUrl('');
      setError('');
      setIsExtracting(true);
    }
  };

  const handleWebViewLoad = () => {
    setIsLoading(false);
  };

  const handleError = (syntheticEvent: any) => {
    const { nativeEvent } = syntheticEvent;
    console.warn('WebView error:', nativeEvent);
    setError('Failed to load the page. Please try again.');
    setIsLoading(false);
    setIsExtracting(false);
  };

  const handleMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'videoUrl') {
        console.log('Found video URL:', data.url);
        setVideoUrl(data.url);
        setIsExtracting(false);
      }
    } catch (error) {
      console.error('Error parsing message:', error);
      setError('Failed to extract video URL');
      setIsExtracting(false);
    }
  };

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
        <link rel="stylesheet" href="https://releases.flowplayer.org/7.2.7/skin/skin.css">
        <script src="https://code.jquery.com/jquery-1.12.4.min.js"></script>
        <script src="https://releases.flowplayer.org/7.2.7/flowplayer.min.js"></script>
        <style>
          body { 
            margin: 0; 
            padding: 0;
            background: #000;
            display: flex;
            justify-content: center;
            align-items: center;
            height: 100vh;
            width: 100vw;
            overflow: hidden;
          }
          .video-container {
            width: 100%;
            height: 100%;
            display: flex;
            justify-content: center;
            align-items: center;
          }
          .flowplayer {
            width: 100% !important;
            height: 100% !important;
          }
          .error-message {
            color: white;
            text-align: center;
            padding: 20px;
            font-family: Arial, sans-serif;
          }
        </style>
      </head>
      <body>
        <div class="video-container">
          ${videoUrl ? `
            <div class="flowplayer" data-key="YOUR_FLOWPLAYER_KEY">
              <video>
                <source type="video/mp4" src="${videoUrl}">
              </video>
            </div>
            <script>
              flowplayer(function (api) {
                api.on('ready', function (e, api, video) {
                  api.play();
                });
                api.on('error', function (e, api, err) {
                  document.body.innerHTML = '<div class="error-message">Failed to load video. The URL might be expired or require authentication.</div>';
                });
              });
            </script>
          ` : ''}
        </div>
      </body>
    </html>
  `;

  return (
    <View style={styles.container}>
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          placeholder="Enter URL to test"
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
        />
        <Button title="Load URL" onPress={handleUrlSubmit} />
      </View>

      {error ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : videoUrl ? (
        <View style={styles.videoContainer}>
          <WebView
            source={{ 
              html: htmlContent,
              headers: {
                'Referer': 'https://mixdrop.ps',
                'Origin': 'https://mixdrop.ps'
              }
            }}
            style={styles.video}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            allowsInlineMediaPlayback={true}
            mediaPlaybackRequiresUserAction={false}
            allowsFullscreenVideo={true}
            onError={handleError}
            userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
          />
        </View>
      ) : (
        url && (
          <View style={styles.webviewContainer}>
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color="#0000ff" />
              <Text style={styles.loadingText}>
                {isLoading ? 'Loading page...' : 'preparing video...'}
              </Text>
            </View>
            <WebView
              source={{ uri: url }}
              style={[styles.webview, { opacity: 0 }]}
              onLoadEnd={handleWebViewLoad}
              onError={handleError}
              injectedJavaScript={videoExtractorScript}
              onMessage={handleMessage}
              javaScriptEnabled={true}
              domStorageEnabled={true}
              startInLoadingState={true}
              scalesPageToFit={true}
              allowsInlineMediaPlayback={true}
              mediaPlaybackRequiresUserAction={false}
              allowsFullscreenVideo={true}
              userAgent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            />
          </View>
        )
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
  },
  inputContainer: {
    flexDirection: 'row',
    marginBottom: 20,
  },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    padding: 10,
    marginRight: 10,
    borderRadius: 5,
  },
  webviewContainer: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
  videoContainer: {
    flex: 1,
    backgroundColor: '#000',
    borderRadius: 5,
    overflow: 'hidden',
  },
  video: {
    flex: 1,
  },
  loadingContainer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#fff',
    zIndex: 1,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorText: {
    color: 'red',
    textAlign: 'center',
    fontSize: 16,
  },
}); 