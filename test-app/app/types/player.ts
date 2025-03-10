export interface VideoMessage {
  type: 'videoUrl';
  url: string;
  subtitleUrl: string | null;
}

export interface SubtitleMessage {
  type: 'subtitleUrl';
  url: string;
}

export interface ErrorMessage {
  type: 'error';
  message: string;
}

export type WebViewMessage = VideoMessage | SubtitleMessage | ErrorMessage; 