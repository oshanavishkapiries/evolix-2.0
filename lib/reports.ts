// Shared by the viewer report dialog, the API and the admin list.

export const REPORT_REASONS = [
  { key: "wont_play", label: "Video won't play" },
  { key: "buffering", label: "Keeps buffering or loads very slowly" },
  { key: "wrong_video", label: "Wrong movie or episode" },
  { key: "audio_problem", label: "Audio missing or out of sync" },
  { key: "wrong_language", label: "Wrong audio language" },
  { key: "subtitle_problem", label: "Subtitles missing or wrong" },
  { key: "poor_quality", label: "Poor video quality" },
  { key: "wrong_info", label: "Wrong title, poster or description" },
  { key: "inappropriate", label: "Inappropriate content" },
  { key: "other", label: "Something else" },
] as const;

export type ReportReason = (typeof REPORT_REASONS)[number]["key"];
export const REASON_KEYS = REPORT_REASONS.map((r) => r.key) as [ReportReason, ...ReportReason[]];
export const reasonLabel = (key: string) => REPORT_REASONS.find((r) => r.key === key)?.label ?? key;

export const MESSAGE_MAX = 1000;
/** "Something else" needs an explanation. */
export const OTHER_MIN = 5;
export type ReportKind = "movie" | "show" | "episode";
export const REPORT_STATUSES = ["open", "resolved", "dismissed"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];
