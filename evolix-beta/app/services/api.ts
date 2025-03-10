import {
  ApiResponse,
  PaginatedResponse,
  TVSeries,
  TVSeriesDetails,
  Season,
  Episode,
} from "../types/api";
import { API_URL } from "../config";
export async function getAllTVSeries(
  page = 1,
  limit = 10
): Promise<ApiResponse<PaginatedResponse<TVSeries>>> {
  try {
    console.log(
      "Fetching TV series from:",
      `${API_URL}/tv-series?page=${page}&limit=${limit}`
    );
    const response = await fetch(
      `${API_URL}/tv-series?page=${page}&limit=${limit}`
    );
    const data = await response.json();
    console.log("API Response:", data);
    return data;
  } catch (error) {
    console.error("API Error:", error);
    throw error;
  }
}

export async function searchTVSeries(
  query: string
): Promise<ApiResponse<PaginatedResponse<TVSeries>>> {
  try {
    console.log("Searching TV series:", query);
    const response = await fetch(
      `${API_URL}/tv-series?search=${encodeURIComponent(query)}`
    );
    const data = await response.json();
    console.log("Search Response:", data);
    return data;
  } catch (error) {
    console.error("Search Error:", error);
    throw error;
  }
}

export async function getTVSeriesDetails(
  id: string
): Promise<ApiResponse<TVSeriesDetails>> {
  try {
    console.log("Fetching TV series details:", id);
    const response = await fetch(`${API_URL}/tv-series/${id}`);
    const data = await response.json();
    console.log("Details Response:", data);
    return data;
  } catch (error) {
    console.error("Details Error:", error);
    throw error;
  }
}

export async function getTVSeriesSeasons(
  id: string
): Promise<ApiResponse<{ seasons: Season[] }>> {
  try {
    console.log("Fetching TV series seasons:", id);
    const response = await fetch(`${API_URL}/tv-series/${id}/seasons`);
    const data = await response.json();
    console.log("Seasons Response:", data);
    return data;
  } catch (error) {
    console.error("Seasons Error:", error);
    throw error;
  }
}

export async function getSeasonEpisodes(
  seasonId: string
): Promise<ApiResponse<Season & { episodes: Episode[] }>> {
  try {
    console.log("Fetching season episodes:", seasonId);
    const response = await fetch(`${API_URL}/tv-series/${seasonId}/episodes`);
    const data = await response.json();
    console.log("Episodes Response:", data);
    return data;
  } catch (error) {
    console.error("Episodes Error:", error);
    throw error;
  }
}
