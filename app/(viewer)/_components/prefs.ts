/**
 * Per-viewer UI preferences kept in localStorage and mirrored onto <html> data attributes,
 * so CSS can lay the page out before React hydrates (no layout jump).
 */
export const PREF_SIDEBAR = "v-sidebar"; // "expanded" | "rail"
export const PREF_SIZE = "v-size"; // "1".."4" card size step
export const CARD_SIZES = ["1", "2", "3", "4"] as const;
export const DEFAULT_SIZE = "2";

/** Inline, render-blocking on purpose; tiny and wrapped so a blocked storage never throws. */
export const PREFS_SCRIPT = `try{var d=document.documentElement,s=localStorage,a=s.getItem("${PREF_SIDEBAR}"),z=s.getItem("${PREF_SIZE}");if(a==="rail"||a==="expanded")d.dataset.vSidebar=a;if(z&&/^[1-4]$/.test(z))d.dataset.vSize=z}catch(e){}`;

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}
