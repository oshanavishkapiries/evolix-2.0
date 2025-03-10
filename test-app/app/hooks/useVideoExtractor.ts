import { useState } from 'react';
import { WebViewMessageEvent } from 'react-native-webview';
import { videoExtractorScript } from '../utils/videoExtractor';

interface VideoExtractorResult {
  videoUrl: string;
  subtitleUrl: string;
  isExtracting: boolean;
  error: string;
  extractVideo: (url: string) => void;
  handleMessage: (event: WebViewMessageEvent) => void;
  handleError: () => void;
}

export function useVideoExtractor(): VideoExtractorResult {
  const [videoUrl, setVideoUrl] = useState('');
  const [subtitleUrl, setSubtitleUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState('');

  const extractVideo = (url: string) => {
    if (url) {
      setIsExtracting(true);
      setError('');
      setVideoUrl('');
      setSubtitleUrl('');
    }
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === "videoUrl") {
        setVideoUrl(data.url);
        if (data.subtitleUrl) {
          setSubtitleUrl(data.subtitleUrl);
        }
        setIsExtracting(false);
      } else if (data.type === "error") {
        setError(data.message);
        setIsExtracting(false);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      setError("Failed to extract URL");
      setIsExtracting(false);
    }
  };

  const handleError = () => {
    setError("Failed to load the page. Please try again.");
    setIsExtracting(false);
  };

  return {
    videoUrl,
    subtitleUrl,
    isExtracting,
    error,
    extractVideo,
    handleMessage,
    handleError,
  };
}

export const getVideoExtractorConfig = (url: string) => ({
  source: {
    uri: url,
    headers: {
      Referer: "https://mixdrop.ps",
      Origin: "https://mixdrop.ps",
    },
  },
  injectedJavaScript: videoExtractorScript,
  javaScriptEnabled: true,
  domStorageEnabled: true,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
}); 