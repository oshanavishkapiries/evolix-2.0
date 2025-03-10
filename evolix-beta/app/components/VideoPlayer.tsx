import React, { useState, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text, ActivityIndicator, Dimensions } from 'react-native';
import Video from 'react-native-video';
import Slider from '@react-native-community/slider';
import Icon from 'react-native-vector-icons/MaterialIcons';
import Orientation from 'react-native-orientation-locker';

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
  const videoRef = useRef(null);
  const [paused, setPaused] = useState(false);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState(null);

  // Format time in MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  // Handle video load start
  const onLoadStart = () => {
    setLoading(true);
    setError(null);
  };

  // Handle video load
  const onLoad = (data: any) => {
    setLoading(false);
    setDuration(data.duration);
  };

  // Handle video progress
  const onProgress = (data: any) => {
    setCurrentTime(data.currentTime);
  };

  // Handle video end
  const onEnd = () => {
    setPaused(true);
    setCurrentTime(0);
    videoRef.current?.seek(0);
  };

  // Handle video error
  const onError = (error: any) => {
    setError(error);
    setLoading(false);
  };

  // Handle seeking
  const onSeek = (value: number) => {
    videoRef.current?.seek(value);
    setCurrentTime(value);
  };

  // Toggle fullscreen
  const toggleFullscreen = () => {
    if (isFullscreen) {
      Orientation.lockToPortrait();
    } else {
      Orientation.lockToLandscape();
    }
    setIsFullscreen(!isFullscreen);
  };

  // Toggle controls visibility
  const toggleControls = () => {
    setShowControls(!showControls);
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity 
        style={styles.videoContainer} 
        onPress={toggleControls}
        activeOpacity={1}
      >
        <Video
          ref={videoRef}
          source={{ 
            uri: videoUrl,
            headers
          }}
          style={styles.video}
          poster={posterUrl}
          posterResizeMode="cover"
          resizeMode="contain"
          paused={paused}
          onLoadStart={onLoadStart}
          onLoad={onLoad}
          onProgress={onProgress}
          onEnd={onEnd}
          onError={onError}
          selectedTextTrack={{
            type: "title",
            value: subtitleUrl ? "Subtitles" : undefined
          }}
          textTracks={subtitleUrl ? [
            {
              title: "Subtitles",
              language: "en",
              type: "text/vtt",
              uri: subtitleUrl
            }
          ] : undefined}
        />

        {loading && (
          <View style={styles.loader}>
            <ActivityIndicator size="large" color="#FFD700" />
          </View>
        )}

        {error && (
          <View style={styles.errorContainer}>
            <Icon name="error-outline" size={50} color="#FFD700" />
            <Text style={styles.errorText}>Error playing video</Text>
            <Text style={styles.errorDetails}>{error.toString()}</Text>
          </View>
        )}

        {showControls && (
          <View style={styles.controls}>
            <View style={styles.topControls}>
              <Text style={styles.title}>{title}</Text>
              <TouchableOpacity onPress={toggleFullscreen}>
                <Icon 
                  name={isFullscreen ? "fullscreen-exit" : "fullscreen"} 
                  size={24} 
                  color="#FFD700" 
                />
              </TouchableOpacity>
            </View>

            <View style={styles.centerControls}>
              <TouchableOpacity onPress={() => onSeek(Math.max(0, currentTime - 10))}>
                <Icon name="replay-10" size={40} color="#FFD700" />
              </TouchableOpacity>
              
              <TouchableOpacity onPress={() => setPaused(!paused)}>
                <Icon 
                  name={paused ? "play-circle-filled" : "pause-circle-filled"} 
                  size={60} 
                  color="#FFD700" 
                />
              </TouchableOpacity>

              <TouchableOpacity onPress={() => onSeek(Math.min(duration, currentTime + 10))}>
                <Icon name="forward-10" size={40} color="#FFD700" />
              </TouchableOpacity>
            </View>

            <View style={styles.bottomControls}>
              <Text style={styles.time}>{formatTime(currentTime)}</Text>
              <Slider
                style={styles.slider}
                minimumValue={0}
                maximumValue={duration}
                value={currentTime}
                onValueChange={onSeek}
                minimumTrackTintColor="#FFD700"
                maximumTrackTintColor="rgba(255,255,255,0.3)"
                thumbTintColor="#FFD700"
              />
              <Text style={styles.time}>{formatTime(duration)}</Text>
            </View>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'black',
  },
  videoContainer: {
    flex: 1,
    justifyContent: 'center',
  },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
    bottom: 0,
    right: 0,
  },
  controls: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    padding: 10,
    justifyContent: 'space-between',
  },
  topControls: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
  },
  centerControls: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 40,
  },
  bottomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 20,
    paddingHorizontal: 10,
  },
  title: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  time: {
    color: 'white',
    fontSize: 12,
    marginHorizontal: 10,
  },
  slider: {
    flex: 1,
    marginHorizontal: 10,
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  errorText: {
    color: 'white',
    fontSize: 16,
    marginTop: 10,
  },
  errorDetails: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 14,
    marginTop: 5,
    textAlign: 'center',
    paddingHorizontal: 20,
  },
});