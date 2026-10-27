/** Shared by the player survey, its API and the admin page. */
export const RATINGS = [
  { value: 1, emoji: "😫", label: "Terrible" },
  { value: 2, emoji: "🙁", label: "Bad" },
  { value: 3, emoji: "😐", label: "Okay" },
  { value: 4, emoji: "🙂", label: "Good" },
  { value: 5, emoji: "😍", label: "Loved it" },
] as const;

/** Follow-up chips: problems for low ratings, highlights for good ones. */
export const ISSUE_TAGS = { buffering: "Buffering", picture: "Picture quality", audio: "Audio / sync", subtitles: "Subtitles", start: "Slow to start", other: "Something else" } as const;
export const PRAISE_TAGS = { smooth: "Smooth playback", picture_good: "Great picture", subtitles_good: "Good subtitles", fast: "Started fast" } as const;
export const FEEDBACK_TAGS = { ...ISSUE_TAGS, ...PRAISE_TAGS };
export type FeedbackTag = keyof typeof FEEDBACK_TAGS;

/** Server-side frequency limits (the client also samples randomly). */
export const FEEDBACK_COOLDOWN_DAYS = 3;
export const COMMENT_MAX = 500;
/** An answer can be completed (tags, comment) for this long after the emoji tap. */
export const FEEDBACK_EDIT_MINUTES = 30;
