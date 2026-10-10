export type WatchPanelKey = "sources" | "episodes";
export const WATCH_PANEL_EVENT = "v-watch-panel";

/** Lets the player's control bar open a shell panel without sharing React state. */
export const openWatchPanel = (key: WatchPanelKey) =>
  window.dispatchEvent(new CustomEvent<WatchPanelKey>(WATCH_PANEL_EVENT, { detail: key }));
