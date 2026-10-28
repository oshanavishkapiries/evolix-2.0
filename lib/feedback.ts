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

/**
 * The attention budget every player question shares, so asking about many features never adds up to nagging:
 * one question per viewing (client), at least GAP_DAYS between questions, at most WEEKLY_MAX in 7 days, and
 * after IGNORE_STREAK questions in a row were ignored, none for BACKOFF_DAYS.
 */
export const BUDGET = { gapDays: FEEDBACK_COOLDOWN_DAYS, weeklyMax: 2, ignoreStreak: 2, backoffDays: 30 } as const;

/** Moments the player can fire. A question in the admin is tied to one of them. */
export const MOMENTS = {
  experience: "After real watching, on pause or at the end",
  subtitle_picked: "A few minutes after the viewer picked a subtitle",
  sinhala_watched: "After watching with Sinhala subtitles for a few minutes",
  quality_switched: "A couple of minutes after the viewer took a quality suggestion",
  busy_waited: "Soon after a viewer waited through the 'busy' screen",
} as const;
export type Moment = keyof typeof MOMENTS;
export const isMoment = (v: unknown): v is Moment => typeof v === "string" && Object.hasOwn(MOMENTS, v);

export type QuestionKind = "thumbs" | "faces";
/** What the player gets back when it may ask something. */
export type Ask = { id: string; key: string; kind: QuestionKind; prompt: string; reasons: string[] };
/** A thumbs or faces answer that should open the "what went wrong?" chips. */
export const isNegative = (kind: QuestionKind, value: number) => (kind === "thumbs" ? value === 0 : value <= 3);
