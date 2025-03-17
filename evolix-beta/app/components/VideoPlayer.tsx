import React, { useState } from "react";
import { View, StyleSheet, ActivityIndicator } from "react-native";
import WebView from "react-native-webview";

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
  headers,
}: VideoPlayerProps) {
  const [loading, setLoading] = useState(true);

  const htmlContent = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons/font/bootstrap-icons.css">
    <link rel="stylesheet" href="https://fonts.googleapis.com/icon?family=Material+Icons">
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f4f4f4;
        margin: 0;
        display: flex;
        justify-content: center;
        align-items: center;
        height: 100vh;
        user-select: none;
      }

      .video-container {
        position: relative;
        width: 100%;
        height: 100%;
        background-color: #000;
        overflow: hidden;
      }

      .preview {
        position: absolute;
        bottom: 100px;
        left: 0;
        width: 150px;
        height: 90px;
        background: rgba(0, 0, 0, 0.5);
        background-size: cover;
        display: none;
        z-index: 3;
      }

      .preview-time {
        position: absolute;
        bottom: 75px;
        left: 0;
        width: 50px;
        text-align: center;
        background: rgba(0, 0, 0, 0.7);
        color: #fff;
        font-size: 12px;
        display: none;
        z-index: 4;
      }

      video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .progress-bar {
        position: absolute;
        bottom: 50px;
        width: calc(100% - 30px);
        left: 15px;
        height: 5px;
        background: rgba(85, 85, 85, 0.5);
        cursor: pointer;
        backdrop-filter: blur(5px);
      }

      .progress-bar div {
        height: 100%;
        width: 0;
        background: #f39c12;
      }

      .controls {
        position: absolute;
        bottom: 5px;
        left: 15px;
        right: 15px;
        width: calc(100% - 30px);
        display: flex;
        justify-content: space-between;
        align-items: center;
        background: transparent;
        color: #f39c12;
        z-index: 2;
        padding-right: 10px;
      }

      .fullscreen-left-controls,
      .fullscreen-right-controls {
        display: none;
        align-items: center;
        background: transparent;
        color: #f39c12;
        z-index: 2;
        padding-right: 10px;
      }

      .controls,
      .fullscreen-left-controls,
      .fullscreen-right-controls,
      .progress-bar,
      .center-controls {
        opacity: 0;
        transition: opacity 0.3s ease;
      }

      .video-container.show-controls .controls,
      .video-container.show-controls .fullscreen-left-controls,
      .video-container.show-controls .fullscreen-right-controls,
      .video-container.show-controls .progress-bar,
      .video-container.show-controls .center-controls {
        opacity: 1;
      }

      .controls button {
        background: none;
        border: none;
        color: #f39c12;
        font-size: 25px;
        cursor: pointer;
      }

      .time {
        min-width: 100px;
      }

      .center-controls {
        position: absolute;
        top: 47%;
        left: 50%;
        transform: translate(-50%, -50%);
        display: flex;
        align-items: center;
        gap: 20px;
        z-index: 2;
        opacity: 1;
      }

      .center-controls button {
        background: transparent;
        border: none;
        color: #f39c12;
        font-size: 75px;
        cursor: pointer;
        transition: background 0.3s ease;
      }

      .center-controls button i {
        font-size: 60px;
      }

      .loading-spinner {
        display: none;
        width: 48px;
        height: 48px;
        border: 5px solid #f39c12;
        border-bottom-color: transparent;
        border-radius: 50%;
        box-sizing: border-box;
        animation: rotation 1s linear infinite;
      }

      @keyframes rotation {
        0% { transform: rotate(0deg); }
        100% { transform: rotate(360deg); }
      }

      #rewind, #forward {
        display: none;
      }

      .video-container:fullscreen .controls {
        display: none;
      }

      .video-container:fullscreen .fullscreen-left-controls,
      .video-container:fullscreen .fullscreen-right-controls {
        display: flex;
      }

      .video-container:fullscreen .fullscreen-left-controls {
        position: absolute;
        bottom: 5px;
        left: 15px;
        right: auto;
        width: auto;
        justify-content: flex-start;
      }

      .video-container:fullscreen .fullscreen-right-controls {
        position: absolute;
        bottom: 5px;
        right: 15px;
        left: auto;
        width: auto;
        justify-content: flex-end;
      }

      .video-container:fullscreen .fullscreen-left-controls button,
      .video-container:fullscreen .fullscreen-right-controls button {
        margin: 0 5px;
        font-size: 30px;
        color: #f39c12;
      }

      .video-container:fullscreen .center-controls button {
        font-size: 100px;
      }

      .video-container:fullscreen .center-controls {
        gap: 100px;
      }

      .video-container:fullscreen .center-controls button i {
        font-size: 80px;
      }

      .video-container:fullscreen .progress-bar {
        bottom: 55px;
        height: 6px;
        width: calc(100% - 30px);
        left: 15px;
      }

      .video-container:fullscreen .time {
        font-size: 20px;
      }

      .error-message {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        background: rgba(255, 0, 0, 0.8);
        color: white;
        padding: 20px;
        border-radius: 10px;
        text-align: center;
        z-index: 10;
        display: none;
      }

      .error-message i {
        font-size: 40px;
        margin-bottom: 10px;
      }

      .video-container:fullscreen .error-message {
        top: 7%;
        width: 400px;
        height: 300px;
      }

      @media (min-width: 768px) {
        .progress-bar {
          bottom: 110px;
          height: 15px;
        }

        .controls {
          bottom: 10px;
          font-size: 30px;
        }

        .controls button {
          font-size: 70px;
        }

        .center-controls {
          gap: 50px;
          top: 50%;
        }

        .center-controls button {
          font-size: 170px;
        }

        .center-controls button i {
          font-size: 170px;
        }

        .time {
          font-size: 50px;
        }
      }
    </style>
  </head>
  <body>
    <div class="video-container" id="video-container">
      <video id="video" src="${videoUrl}" type="video/mp4" data-poster="${posterUrl || ''}">
        ${
          subtitleUrl
            ? `<track src="${'https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-HD.fr.vtt'}" kind="subtitles" srclang="en" label="English" default>`
            : ""
        }
      </video>
      <div id="preview" class="preview"></div>
      <div id="preview-time" class="preview-time"></div>
      <div id="error-message" class="error-message hidden">
        <i class="bi bi-wifi-off"></i>
        <p>This video cannot be played because of a problem with your internet connection.<br>(Error Code: 230002)</p>
      </div>
      <div class="center-controls" id="center-controls">
        <button id="rewind" style="display: none;"><i class="material-icons">replay_10</i></button>
        <div class="loading-spinner" id="loading-spinner"></div>
        <button id="play-pause"><i class="bi bi-play-fill"></i></button>
        <button id="forward" style="display: none;"><i class="material-icons">forward_10</i></button>
      </div>
      <div class="progress-bar" id="progress-bar">
        <div id="progress"></div>
      </div>
      <div class="controls normal-controls">
        <button id="volume-toggle"><i class="bi bi-volume-up-fill"></i></button>
        <div class="time" id="time">00:00 / 00:00</div>
        <button id="fullscreen"><i class="fa-solid fa-expand"></i></button>
      </div>
      <div class="fullscreen-left-controls controls">
        <button id="volume-toggle-fullscreen"><i class="bi bi-volume-up-fill"></i></button>
        <div class="time" id="time-fullscreen">00:00 / 00:00</div>
      </div>
      <div class="fullscreen-right-controls controls">
        <button id="fullscreen-exit"><i class="fa-solid fa-compress"></i></button>
      </div>
    </div>
    <script>
      document.addEventListener('DOMContentLoaded', function() {
        const video = document.getElementById('video');
        const playPauseButton = document.getElementById('play-pause');
        const rewindButton = document.getElementById('rewind');
        const forwardButton = document.getElementById('forward');
        const progressBar = document.getElementById('progress-bar');
        const progress = document.getElementById('progress');
        const fullscreenButton = document.getElementById('fullscreen');
        const fullscreenExitButton = document.getElementById('fullscreen-exit');
        const timeDisplay = document.getElementById('time');
        const timeDisplayFullscreen = document.getElementById('time-fullscreen');
        const volumeToggleButton = document.getElementById('volume-toggle');
        const volumeToggleFullscreenButton = document.getElementById('volume-toggle-fullscreen');
        const videoContainer = document.getElementById('video-container');
        const loadingSpinner = document.getElementById('loading-spinner');
        const centerControls = document.getElementById('center-controls');
        const errorMessage = document.getElementById('error-message');
        const preview = document.getElementById('preview');
        const previewTime = document.getElementById('preview-time');

        const previewImages = [
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_001-8mJkdJK8PtAuDyGhXtQIHmBqcPQQ2U.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_002-uzfoIz6nvtKnaYLcKPFO2zkxPwTweX.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_003-iU2jbHJGNMGqtUuujWVTMN2GqepqV8.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_004-eOgZmtE4z3uLrDCd2Sk6atWxLuJZLb.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_005-coZc2ymrOJ7TwfVn6Id4gTEABb2hzI.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_006-dbwJKr2tRDZyucwsBpEkaAOb1XW2Qx.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_007-pn4iNYzzxFdKL5TBYhin0mtpQ8QuWD.png',
          'https://s37o60krxrtmmx77.public.blob.vercel-storage.com/spongebob/thumb_008-n2INvZKGJjlKU5T8ARwVSO5ovnrwTU.png'
        ];

        progressBar.addEventListener('mousemove', (event) => {
          updatePreview(event.clientX);
          showControls();
          hideCenterControls();
        });

        progressBar.addEventListener('mouseleave', () => {
          preview.style.display = 'none';
          previewTime.style.display = 'none';
          hideControls();
          showCenterControls();
        });

        progressBar.addEventListener('click', (event) => {
          const rect = progressBar.getBoundingClientRect();
          const pos = (event.clientX - rect.left) / rect.width;
          video.currentTime = pos * video.duration;
          preview.style.display = 'none';
          previewTime.style.display = 'none';
          showControls();
        });

        let isTouching = false;
        let initialTouchX = 0;
        let initialTime = 0;
        let wasPlaying = false;

        progressBar.addEventListener('touchstart', (event) => {
          isTouching = true;
          initialTouchX = event.touches[0].clientX;
          initialTime = video.currentTime;
          wasPlaying = !video.paused;
          video.pause();
          updateVideoTime(event.touches[0].clientX);
          showControls();
          hideCenterControls();
          clearTimeout(controlsTimeout);
        });

        progressBar.addEventListener('touchmove', (event) => {
          if (isTouching) {
            updateVideoTime(event.touches[0].clientX);
            showControls();
            hideCenterControls();
          }
        });

        progressBar.addEventListener('touchend', (event) => {
          isTouching = false;
          const rect = progressBar.getBoundingClientRect();
          const pos = (event.changedTouches[0].clientX - rect.left) / rect.width;
          video.currentTime = pos * video.duration;
          preview.style.display = 'none';
          previewTime.style.display = 'none';
          if (wasPlaying) video.play();
          controlsTimeout = setTimeout(hideControls, 3000);
          showCenterControls();
        });

        function updateVideoTime(clientX) {
          const rect = progressBar.getBoundingClientRect();
          const pos = (clientX - rect.left) / rect.width;
          const newTime = pos * video.duration;
          progress.style.width = \`\${pos * 100}%\`;
          updatePreviewThumbnail(newTime, clientX - rect.left);
          updatePreviewTime(newTime, clientX - rect.left);
        }

        function updatePreviewThumbnail(time, clientX) {
          const previewIndex = Math.floor((time / video.duration) * previewImages.length);
          const previewImage = previewImages[previewIndex];
          preview.style.backgroundImage = \`url(\${previewImage})\`;
          preview.style.display = 'block';
          preview.style.left = \`\${clientX - preview.offsetWidth / 2}px\`;
        }

        function updatePreviewTime(time, clientX) {
          const minutes = Math.floor(time / 60).toString().padStart(2, '0');
          const seconds = Math.floor(time % 60).toString().padStart(2, '0');
          previewTime.textContent = \`\${minutes}:\${seconds}\`;
          previewTime.style.display = 'block';
          previewTime.style.left = \`\${clientX - previewTime.offsetWidth / 2}px\`;
        }

        function hideCenterControls() {
          centerControls.style.display = 'none';
        }

        function showCenterControls() {
          if (!video.seeking && !video.waiting) {
            centerControls.style.display = 'flex';
          }
        }

        let controlsVisible = false;
        let controlsTimeout;
        let firstPlay = true;

        const showControls = () => {
          videoContainer.classList.add('show-controls');
          centerControls.style.opacity = 1;
          controlsVisible = true;
          clearTimeout(controlsTimeout);
          if (!video.paused && !isTouching && !video.waiting) {
            controlsTimeout = setTimeout(hideControls, 3000);
          }
        };

        const hideControls = () => {
          if (video.paused || isTouching || video.seeking || video.waiting) return;
          videoContainer.classList.remove('show-controls');
          centerControls.style.opacity = 0;
          controlsVisible = false;
        };

        videoContainer.addEventListener('click', (event) => {
          if (event.target.closest('.controls') || event.target.closest('.center-controls')) {
            return;
          }
          if (controlsVisible) hideControls();
          else showControls();
        });

        video.addEventListener('pause', () => {
          showControls();
          centerControls.style.opacity = 1;
          rewindButton.style.display = 'block';
          forwardButton.style.display = 'block';
        });

        video.addEventListener('play', () => {
          hideControls();
          rewindButton.style.display = 'block';
          forwardButton.style.display = 'block';
        });

        video.addEventListener('waiting', () => {
          loadingSpinner.style.display = 'block';
          playPauseButton.style.display = 'none';
          centerControls.style.display = 'flex';
          hideControls();
        });

        video.addEventListener('playing', () => {
          loadingSpinner.style.display = 'none';
          playPauseButton.style.display = 'block';
          centerControls.style.display = 'flex';
          showControls();
        });

        video.addEventListener('timeupdate', () => {
          const currentTime = Math.floor(video.currentTime);
          const duration = Math.floor(video.duration);
          progress.style.width = \`\${(currentTime / duration) * 100}%\`;
          const formatTime = (time) => {
            const minutes = Math.floor(time / 60).toString().padStart(2, '0');
            const seconds = (time % 60).toString().padStart(2, '0');
            return \`\${minutes}:\${seconds}\`;
          };
          timeDisplay.textContent = \`\${formatTime(currentTime)} / \${formatTime(duration)}\`;
          timeDisplayFullscreen.textContent = \`\${formatTime(currentTime)} / \${formatTime(duration)}\`;
        });

        video.addEventListener('error', () => {
          errorMessage.style.display = 'block';
        });

        video.addEventListener('play', () => {
          errorMessage.style.display = 'none';
        });

        playPauseButton.addEventListener('click', (event) => {
          event.stopPropagation();
          if (firstPlay) {
            video.play();
            playPauseButton.innerHTML = '<i class="bi bi-pause-fill"></i>';
            firstPlay = false;
          } else {
            if (!controlsVisible) {
              showControls();
            } else {
              if (video.paused) {
                video.play();
                playPauseButton.innerHTML = '<i class="bi bi-pause-fill"></i>';
              } else {
                video.pause();
                playPauseButton.innerHTML = '<i class="bi bi-play-fill"></i>';
              }
            }
          }
        });

        rewindButton.addEventListener('click', (event) => {
          if (!controlsVisible) {
            showControls();
            return;
          }
          event.stopPropagation();
          video.currentTime -= 10;
        });

        forwardButton.addEventListener('click', (event) => {
          if (!controlsVisible) {
            showControls();
            return;
          }
          event.stopPropagation();
          video.currentTime += 10;
        });

        const toggleMute = () => {
          video.muted = !video.muted;
          const volumeIcon = video.muted ? '<i class="bi bi-volume-mute-fill"></i>' : '<i class="bi bi-volume-up-fill"></i>';
          volumeToggleButton.innerHTML = volumeIcon;
          volumeToggleFullscreenButton.innerHTML = volumeIcon;
        };

        volumeToggleButton.addEventListener('click', (event) => {
          if (!controlsVisible) {
            showControls();
            return;
          }
          event.stopPropagation();
          toggleMute();
        });

        volumeToggleFullscreenButton.addEventListener('click', (event) => {
          if (!controlsVisible) {
            showControls();
            return;
          }
          event.stopPropagation();
          toggleMute();
        });

        fullscreenButton.addEventListener('click', (event) => {
          if (!controlsVisible) {
            showControls();
            return;
          }
          event.stopPropagation();
          if (!document.fullscreenElement) enterFullscreen();
          else exitFullscreen();
        });

        fullscreenExitButton.addEventListener('click', (event) => {
          if (!controlsVisible) {
            showControls();
            return;
          }
          event.stopPropagation();
          exitFullscreen();
        });

        const enterFullscreen = () => {
          if (videoContainer.requestFullscreen) videoContainer.requestFullscreen();
          fullscreenButton.innerHTML = '<i class="fa-solid fa-compress"></i>';
          fullscreenExitButton.innerHTML = '<i class="fa-solid fa-compress"></i>';
        };

        const exitFullscreen = () => {
          if (document.exitFullscreen) document.exitFullscreen();
          fullscreenButton.innerHTML = '<i class="fa-solid fa-expand"></i>';
          fullscreenExitButton.innerHTML = '<i class="fa-solid fa-expand"></i>';
        };

        document.addEventListener('fullscreenchange', () => {
          if (!document.fullscreenElement) {
            fullscreenButton.innerHTML = '<i class="fa-solid fa-expand"></i>';
          } else {
            fullscreenButton.innerHTML = '<i class="fa-solid fa-compress"></i>';
          }
        });

        function updatePreview(clientX) {
          const rect = progressBar.getBoundingClientRect();
          const pos = (clientX - rect.left) / rect.width;
          const previewTimeValue = pos * video.duration;
          preview.style.display = 'block';
          preview.style.left = \`\${clientX - rect.left - preview.offsetWidth / 2}px\`;
          const previewIndex = Math.floor((previewTimeValue / video.duration) * previewImages.length);
          const previewImage = previewImages[previewIndex];
          preview.style.backgroundImage = \`url(\${previewImage})\`;
          const minutes = Math.floor(previewTimeValue / 60).toString().padStart(2, '0');
          const seconds = Math.floor(previewTimeValue % 60).toString().padStart(2, '0');
          previewTime.textContent = \`\${minutes}:\${seconds}\`;
          previewTime.style.display = 'block';
          previewTime.style.left = \`\${clientX - previewTime.offsetWidth / 2}px\`;
        }
      });
    </script>
  </body>
  </html>
  `;

  return (
    <View style={styles.container}>
      <WebView
        source={{ html: htmlContent , headers: headers }}
        style={styles.webview}
        onLoadStart={() => setLoading(true)}
        onLoadEnd={() => setLoading(false)}
        allowsFullscreenVideo={true}
        mediaPlaybackRequiresUserAction={false}
        mixedContentMode="always"
        javaScriptEnabled={true}
        domStorageEnabled={true}
        originWhitelist={["*"]}
        onError={(syntheticEvent) => {
          const { nativeEvent } = syntheticEvent;
          console.warn("WebView error:", nativeEvent);
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
    backgroundColor: "black",
  },
  webview: {
    flex: 1,
    backgroundColor: "black",
  },
  loader: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "black",
  },
});