export interface Image {
  low: string;
  high: string;
  original: string;
  _id: string;
}

export interface Stream {
  provider: string;
  video_link: string;
  subtitle_link: string;
  quality: string;
  _id: string;
}

export interface TVSeries {
  _id: string;
  tmdb_id: number;
  logos: { low: string; high: string; original: string; _id: string }[];
  genres: string;
  mainBackdrop: Image;
  mainPoster: Image;
  numberOfSeasons: number;
  rating: string;
  title: string;
  year: string;
  score: number;
  id: string;
}

export interface TVSeriesDetails extends TVSeries {
  backdrops: Image[];
  logos: { low: string; high: string; original: string; _id: string }[];
  numberOfEpisodes: number;
  overview: string;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface Season {
  _id: string;
  seasonNumber: number;
  tmdb_id: number;
  airDate: string;
  episodeCount: number;
  name: string;
  overview: string;
  poster: Image;
  series: string;
  id: string;
}

export interface Episode {
  _id: string;
  episodeNumber: number;
  airDate: string;
  name: string;
  overview: string;
  poster: Image;
  rating: string;
  stream: Stream;
}

export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  data: T;
}

export interface PaginatedResponse<T> {
  results: T[];
  pageCount: number;
  itemCount: number;
  pages: { number: number; url: string }[];
  hasMore: boolean;
  currentPage: number;
} 