export const videoExtractorScript = `
  (function() {
    // Function to find and click play button
    function findAndClickPlayButton() {
      const playButton = document.querySelector('button.vjs-big-play-button');
      if (playButton) {
        playButton.click();
        return true;
      }
      return false;
    }

    // Function to find video URL
    function findVideoUrl() {
      const video = document.querySelector('video');
      if (video && video.src) {
        return video.src;
      }
      return null;
    }

    // Main process
    function startExtraction() {
      // Try to find and click play button
      const buttonClicked = findAndClickPlayButton();
      
      // Wait for video to load
      const checkVideo = setInterval(() => {
        const videoUrl = findVideoUrl();
        if (videoUrl) {
          clearInterval(checkVideo);
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'videoUrl',
            url: videoUrl,
            headers: {}
          }));
        }
      }, 1000);

      // Stop checking after 30 seconds
      setTimeout(() => {
        clearInterval(checkVideo);
      }, 30000);
    }

    // Start when page is ready
    if (document.readyState === 'complete') {
      startExtraction();
    } else {
      window.addEventListener('load', startExtraction);
    }

    true;
  })();
`; 