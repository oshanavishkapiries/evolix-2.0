module.exports = `(function() {
    function sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }

    async function simulateRandomClicks(element, count = 10) {
      for (let i = 0; i < count; i++) {
        // Random delay between 500ms and 2000ms
        const delay = Math.floor(Math.random() * 1500) + 500;
        await sleep(delay);
        
        // Random position within the element
        const rect = element.getBoundingClientRect();
        const x = rect.left + Math.floor(Math.random() * rect.width);
        const y = rect.top + Math.floor(Math.random() * rect.height);
        
        // Create and dispatch click events
        const clickEvent = new MouseEvent('click', {
          view: window,
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y
        });
        element.dispatchEvent(clickEvent);
      }
    }

    async function extractSubtitleLink() {
      const downloadButton = document.querySelector('a.btn.btn3.download-btn');
      if (downloadButton) {
        // Create a MutationObserver to watch for href changes
        const observer = new MutationObserver((mutations) => {
          mutations.forEach((mutation) => {
            if (mutation.type === 'attributes' && mutation.attributeName === 'href') {
              const link = downloadButton.getAttribute('href');
              if (link && link !== '#' && !link.includes('javascript:')) {
                // Found valid href, send it back
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'subtitleUrl',
                  url: link
                }));
                // Stop observing
                observer.disconnect();
              }
            }
          });
        });

        // Start observing the download button for attribute changes
        observer.observe(downloadButton, {
          attributes: true,
          attributeFilter: ['href']
        });

        // Start simulating random clicks
        await simulateRandomClicks(downloadButton);

        // Set a timeout to stop watching after 30 seconds
        setTimeout(() => {
          observer.disconnect();
          // If no link was found, send an error
          const finalHref = downloadButton.getAttribute('href');
          if (!finalHref || finalHref === '#' || finalHref.includes('javascript:')) {
            window.ReactNativeWebView.postMessage(JSON.stringify({
              type: 'error',
              message: 'Failed to extract subtitle URL'
            }));
          }
        }, 30000);
      }
    }

    // Start when page is ready
    if (document.readyState === 'complete') {
      extractSubtitleLink();
    } else {
      window.addEventListener('load', extractSubtitleLink);
    }

    true;
  })();`;