module.exports = `(function() {
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
      // Try different video selectors
      const videoSelectors = [
        'video source[type="video/mp4"]',
        'video source',
        'video'
      ];

      for (const selector of videoSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const url = element.src || element.getAttribute('src');
          if (url) return url;
        }
      }
      return null;
    }

    // Function to find subtitle URL
    function findSubtitleUrl() {
      // Try different subtitle selectors
      const subtitleSelectors = [
        'track[kind="subtitles"]',
        'track[kind="captions"]',
        '.vjs-text-track-display'
      ];

      for (const selector of subtitleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          const url = element.src || element.getAttribute('src');
          if (url) return url;
        }
      }
      return null;
    }

    // Main process
    function startExtraction() {
      // Try to find and click play button
      const buttonClicked = findAndClickPlayButton();
      
      // Wait for video and subtitle to load
      const checkMedia = setInterval(() => {
        const videoUrl = findVideoUrl();
        const subtitleUrl = findSubtitleUrl();

        if (videoUrl) {
          clearInterval(checkMedia);
          window.ReactNativeWebView.postMessage(JSON.stringify({
            type: 'videoUrl',
            url: videoUrl,
            subtitleUrl: subtitleUrl || null
          }));
        }
      }, 1000);

      // Stop checking after 30 seconds
      setTimeout(() => {
        clearInterval(checkMedia);
      }, 30000);
    }

    // Start when page is ready
    if (document.readyState === 'complete') {
      startExtraction();
    } else {
      window.addEventListener('load', startExtraction);
    }

    true;
  })();`;