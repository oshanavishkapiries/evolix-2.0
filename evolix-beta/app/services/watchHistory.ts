import AsyncStorage from "@react-native-async-storage/async-storage";
import { WatchHistoryItem, WatchHistoryState } from "../types/watchHistory";

const WATCH_HISTORY_KEY = "@evolix_watch_history";
const MAX_HISTORY_ITEMS = 50;

export const WatchHistoryService = {
  async getWatchHistory(): Promise<WatchHistoryState> {
    try {
      const history = await AsyncStorage.getItem(WATCH_HISTORY_KEY);
      if (history) {
        return JSON.parse(history);
      }
      return { items: [], lastUpdated: Date.now() };
    } catch (error) {
      console.error("Error getting watch history:", error);
      return { items: [], lastUpdated: Date.now() };
    }
  },

  async addToWatchHistory(item: WatchHistoryItem): Promise<void> {
    try {
      const history = await this.getWatchHistory();

      // Remove existing entry for this episode if it exists
      const filteredItems = history.items.filter(
        (i) => i.episodeId !== item.episodeId
      );

      // Add new item at the beginning
      const newItems = [item, ...filteredItems].slice(0, MAX_HISTORY_ITEMS);

      const newHistory: WatchHistoryState = {
        items: newItems,
        lastUpdated: Date.now(),
      };

      await AsyncStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(newHistory));
    } catch (error) {
      console.error("Error adding to watch history:", error);
    }
  },

  async updateWatchTimestamp(
    episodeId: string,
    timestamp: number
  ): Promise<void> {
    try {
      const history = await this.getWatchHistory();
      const updatedItems = history.items.map((item) => {
        if (item.episodeId === episodeId) {
          return {
            ...item,
            timestamp,
            lastWatchedAt: Date.now(),
          };
        }
        return item;
      });

      const newHistory: WatchHistoryState = {
        items: updatedItems,
        lastUpdated: Date.now(),
      };

      await AsyncStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(newHistory));
    } catch (error) {
      console.error("Error updating watch timestamp:", error);
    }
  },

  async clearWatchHistory(): Promise<void> {
    try {
      await AsyncStorage.removeItem(WATCH_HISTORY_KEY);
    } catch (error) {
      console.error("Error clearing watch history:", error);
    }
  },
};
