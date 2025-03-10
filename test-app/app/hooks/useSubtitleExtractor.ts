import { useState } from 'react';
import { WebViewMessageEvent } from 'react-native-webview';
import { subtitleExtractorScript } from '../utils/subtitleExtractor';

interface SubtitleExtractorResult {
  subtitleUrl: string;
  isExtracting: boolean;
  error: string;
  extractSubtitle: (url: string) => void;
  handleMessage: (event: WebViewMessageEvent) => void;
  handleError: () => void;
}

export function useSubtitleExtractor(): SubtitleExtractorResult {
  const [subtitleUrl, setSubtitleUrl] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState('');

  const extractSubtitle = (url: string) => {
    if (url) {
      setIsExtracting(true);
      setError('');
      setSubtitleUrl('');
    }
  };

  const handleMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      
      if (data.type === "subtitleUrl") {
        setSubtitleUrl(data.url);
        setIsExtracting(false);
      } else if (data.type === "error") {
        setError(data.message);
        setIsExtracting(false);
      }
    } catch (error) {
      console.error("Error parsing message:", error);
      setError("Failed to extract subtitle URL");
      setIsExtracting(false);
    }
  };

  const handleError = () => {
    setError("Failed to load the subtitle page. Please try again.");
    setIsExtracting(false);
  };

  return {
    subtitleUrl,
    isExtracting,
    error,
    extractSubtitle,
    handleMessage,
    handleError,
  };
}

export const getSubtitleExtractorConfig = (url: string) => ({
  source: {
    uri: url,
    headers: {
      Referer: "https://mixdrop.ps",
      Origin: "https://mixdrop.ps",
    },
  },
  injectedJavaScript: subtitleExtractorScript,
  javaScriptEnabled: true,
  domStorageEnabled: true,
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
}); 