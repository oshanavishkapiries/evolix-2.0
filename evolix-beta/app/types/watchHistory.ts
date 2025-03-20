export interface WatchHistoryItem {
  id: string;
  seriesId: string;
  seriesTitle: string;
  episodeId: string;
  episodeTitle: string;
  episodeNumber: number;
  seasonNumber: number;
  timestamp: number;
  lastWatchedAt: number;
  thumbnailUrl?: string;
  provider: string;
  videoUrl: string;
  subtitleUrl: string;
}

export interface WatchHistoryState {
  items: WatchHistoryItem[];
  lastUpdated: number;
}
