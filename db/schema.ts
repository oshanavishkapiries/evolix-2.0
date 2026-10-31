import { sql } from "drizzle-orm";
import {
  boolean,
  bigint,
  bigserial,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

export const otpPurpose = pgEnum("otp_purpose", [
  "verify_email",
  "reset_password",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  /** Set by an admin; viewers may watch only when approved (while the approval requirement is on). */
  approvedAt: timestamp("approved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const otps = pgTable("otps", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  purpose: otpPurpose("purpose").notNull(),
  codeHash: text("code_hash").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  attempts: integer("attempts").notNull().default(0),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  refreshTokenHash: text("refresh_token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  ip: text("ip"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  replacedBy: uuid("replaced_by"),
});

// ---------------------------------------------------------------- CMS

export const sourceKind = pgEnum("source_kind", ["direct", "hls", "embed"]);
export const videoSite = pgEnum("video_site", ["youtube", "vimeo"]);
export const videoType = pgEnum("video_type", [
  "trailer",
  "teaser",
  "clip",
  "featurette",
  "behind_the_scenes",
  "bloopers",
  "opening_credits",
  "other",
]);
export const subtitleFormat = pgEnum("subtitle_format", ["vtt", "srt"]);
export const subtitleSource = pgEnum("subtitle_source", ["auto", "opensubtitles", "upload", "translation"]);
export const subtitleVisibility = pgEnum("subtitle_visibility", ["private", "shared"]);
/** Legacy: the Kids section was removed and nothing reads this column; kept so no data migration is needed. */
export const audience = pgEnum("audience", ["general", "kids", "both"]);

export type CastMember = {
  name: string;
  character: string;
  profilePath: string | null;
};

const stamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
};

export const movies = pgTable("movies", {
  id: uuid("id").primaryKey().defaultRandom(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  title: text("title").notNull(),
  originalTitle: text("original_title").notNull().default(""),
  tagline: text("tagline").notNull().default(""),
  overview: text("overview").notNull().default(""),
  releaseDate: date("release_date"),
  runtimeMinutes: integer("runtime_minutes"),
  genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
  rating: real("rating"),
  voteCount: integer("vote_count"),
  originalLanguage: text("original_language").notNull().default(""),
  status: text("status").notNull().default(""),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  logoPath: text("logo_path"),
  galleryBackdrops: jsonb("gallery_backdrops").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  cast: jsonb("cast").$type<CastMember[]>().notNull().default(sql`'[]'::jsonb`),
  isPublished: boolean("is_published").notNull().default(false),
  audience: audience("audience").notNull().default("general"),
  ...stamps,
});

export const shows = pgTable("shows", {
  id: uuid("id").primaryKey().defaultRandom(),
  tmdbId: integer("tmdb_id").notNull().unique(),
  name: text("name").notNull(),
  originalName: text("original_name").notNull().default(""),
  tagline: text("tagline").notNull().default(""),
  overview: text("overview").notNull().default(""),
  firstAirDate: date("first_air_date"),
  lastAirDate: date("last_air_date"),
  status: text("status").notNull().default(""),
  genres: text("genres").array().notNull().default(sql`'{}'::text[]`),
  rating: real("rating"),
  voteCount: integer("vote_count"),
  originalLanguage: text("original_language").notNull().default(""),
  posterPath: text("poster_path"),
  backdropPath: text("backdrop_path"),
  logoPath: text("logo_path"),
  galleryBackdrops: jsonb("gallery_backdrops").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  cast: jsonb("cast").$type<CastMember[]>().notNull().default(sql`'[]'::jsonb`),
  isPublished: boolean("is_published").notNull().default(false),
  audience: audience("audience").notNull().default("general"),
  ...stamps,
});

export const seasons = pgTable(
  "seasons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    showId: uuid("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id"),
    seasonNumber: integer("season_number").notNull(),
    name: text("name").notNull().default(""),
    overview: text("overview").notNull().default(""),
    airDate: date("air_date"),
    posterPath: text("poster_path"),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (t) => [
    unique("seasons_show_number_uq").on(t.showId, t.seasonNumber),
    index("seasons_show_id_idx").on(t.showId),
  ],
);

export const episodes = pgTable(
  "episodes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    seasonId: uuid("season_id")
      .notNull()
      .references(() => seasons.id, { onDelete: "cascade" }),
    tmdbId: integer("tmdb_id"),
    episodeNumber: integer("episode_number").notNull(),
    name: text("name").notNull().default(""),
    overview: text("overview").notNull().default(""),
    airDate: date("air_date"),
    runtimeMinutes: integer("runtime_minutes"),
    stillPath: text("still_path"),
    isVisible: boolean("is_visible").notNull().default(true),
  },
  (t) => [
    unique("episodes_season_number_uq").on(t.seasonId, t.episodeNumber),
    index("episodes_season_id_idx").on(t.seasonId),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: sourceKind("kind").notNull(),
    url: text("url").notNull(),
    quality: text("quality"),
    /** Audio (dub) language code such as "si" or "en"; empty = unspecified. */
    audioLanguage: text("audio_language").notNull().default(""),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    /** Evo engine that cached this file (null for sources added by hand or before multi-engine). */
    engineId: text("engine_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sources_movie_id_idx").on(t.movieId),
    index("sources_episode_id_idx").on(t.episodeId),
    // One cached file per quality: Evo promotion upserts on these. NULL quality (embeds) never collides.
    unique("sources_movie_quality_uq").on(t.movieId, t.quality),
    unique("sources_episode_quality_uq").on(t.episodeId, t.quality),
    check(
      "sources_one_parent_chk",
      sql`(${t.movieId} is null) <> (${t.episodeId} is null)`,
    ),
  ],
);

export const subtitles = pgTable(
  "subtitles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    language: text("language").notNull(),
    url: text("url").notNull(),
    format: subtitleFormat("format").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    /** Evo engine that produced this track (null for manual tracks or before multi-engine). */
    engineId: text("engine_id"),
    source: subtitleSource("source").notNull().default("auto"),
    originRef: text("origin_ref"),
    originKey: text("origin_key").generatedAlwaysAs(sql`coalesce(origin_ref, '')`),
    originTrackId: uuid("origin_track_id").references((): AnyPgColumn => subtitles.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    visibility: subtitleVisibility("visibility").notNull().default("shared"),
    score: integer("score").notNull().default(0),
    playsOk: integer("plays_ok").notNull().default(0),
    reports: integer("reports").notNull().default(0),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    hidden: boolean("hidden").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subtitles_movie_id_idx").on(t.movieId),
    index("subtitles_episode_id_idx").on(t.episodeId),
    uniqueIndex("subtitles_movie_origin_uq").on(t.movieId, t.language, t.source, t.originKey).where(sql`${t.movieId} is not null`),
    uniqueIndex("subtitles_episode_origin_uq").on(t.episodeId, t.language, t.source, t.originKey).where(sql`${t.episodeId} is not null`),
    check(
      "subtitles_one_parent_chk",
      sql`(${t.movieId} is null) <> (${t.episodeId} is null)`,
    ),
  ],
);

/** Distinct successful viewers for upload promotion, plus one vote and report per viewer/track. */
export const subtitleActivity = pgTable("subtitle_activity", {
  trackId: uuid("track_id").notNull().references(() => subtitles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  playedAt: timestamp("played_at", { withTimezone: true }),
  good: boolean("good").notNull().default(false),
  problem: text("problem"),
}, (t) => [primaryKey({ columns: [t.trackId, t.userId] })]);

/** Completed viewing sessions score once each; activity keeps distinct viewer history for promotion. */
export const subtitlePlays = pgTable("subtitle_plays", {
  id: uuid("id").primaryKey(),
  trackId: uuid("track_id").notNull().references(() => subtitles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, (t) => [index("subtitle_plays_track_user_idx").on(t.trackId, t.userId)]);

/** Atomic daily reservations for uploads and new translations. */
export const subtitleQuota = pgTable("subtitle_quota", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  mediaKey: text("media_key").notNull(),
  kind: text("kind").notNull(),
  day: date("day").notNull().default(sql`current_date`),
  used: integer("used").notNull().default(1),
}, (t) => [primaryKey({ columns: [t.userId, t.mediaKey, t.kind, t.day] })]);

export const subtitleGrants = pgTable("subtitle_grants", {
  trackId: uuid("track_id").notNull().references(() => subtitles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
}, (t) => [primaryKey({ columns: [t.trackId, t.userId] })]);

export const videos = pgTable(
  "videos",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
    site: videoSite("site").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    type: videoType("type").notNull(),
    official: boolean("official").notNull().default(false),
    language: text("language"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    isVisible: boolean("is_visible").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("videos_movie_id_idx").on(t.movieId),
    index("videos_show_id_idx").on(t.showId),
    uniqueIndex("videos_movie_site_key_uq")
      .on(t.movieId, t.site, t.key)
      .where(sql`${t.movieId} is not null`),
    uniqueIndex("videos_show_site_key_uq")
      .on(t.showId, t.site, t.key)
      .where(sql`${t.showId} is not null`),
    check("videos_one_parent_chk", sql`(${t.movieId} is null) <> (${t.showId} is null)`),
  ],
);

// Per-user "My List". Exactly one of movie_id / show_id is set.
export const bookmarks = pgTable(
  "bookmarks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("bookmarks_one_target", sql`(${t.movieId} is null) <> (${t.showId} is null)`),
    unique("bookmarks_user_movie_uq").on(t.userId, t.movieId),
    unique("bookmarks_user_show_uq").on(t.userId, t.showId),
    index("bookmarks_user_created_idx").on(t.userId, t.createdAt),
  ],
);

// Per-user playback position for a movie or an episode. Exactly one of movie_id / episode_id is set.
export const watchProgress = pgTable(
  "watch_progress",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    positionSeconds: integer("position_seconds").notNull().default(0),
    durationSeconds: integer("duration_seconds").notNull().default(0),
    completed: boolean("completed").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("watch_progress_one_target", sql`(${t.movieId} is null) <> (${t.episodeId} is null)`),
    unique("watch_progress_user_movie_uq").on(t.userId, t.movieId),
    unique("watch_progress_user_episode_uq").on(t.userId, t.episodeId),
    index("watch_progress_user_updated_idx").on(t.userId, t.updatedAt),
  ],
);

// ---------------------------------------------------------------- Reports

export const reportStatus = pgEnum("report_status", ["open", "resolved", "dismissed"]);

/** A viewer's problem report about a movie, a show or one episode. `reason` is a key from lib/reports.ts. */
export const reports = pgTable(
  "reports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "cascade" }),
    showId: uuid("show_id").references(() => shows.id, { onDelete: "cascade" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "cascade" }),
    reason: text("reason").notNull(),
    message: text("message").notNull().default(""),
    status: reportStatus("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  },
  (t) => [
    check(
      "reports_one_target",
      sql`(${t.movieId} is not null)::int + (${t.showId} is not null)::int + (${t.episodeId} is not null)::int = 1`,
    ),
    index("reports_status_created_idx").on(t.status, t.createdAt),
    index("reports_user_created_idx").on(t.userId, t.createdAt),
  ],
);

/** Platform-wide switches an admin can flip at runtime (key -> JSON value). */
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- Announcements

export const announcementAudience = pgEnum("announcement_audience", ["everyone", "admins", "users"]);
export const announcementPriority = pgEnum("announcement_priority", ["inbox", "banner", "popup"]);
/** Only the stored lifecycle; scheduled/live/expired are derived from publishAt/expiresAt (lib/announcements.ts). */
export const announcementStatus = pgEnum("announcement_status", ["draft", "published", "archived"]);

/** An in-app notification an admin sends to a set of users. */
export const announcements = pgTable(
  "announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    linkUrl: text("link_url"),
    imageUrl: text("image_url"),
    bannerImageUrl: text("banner_image_url"),
    audience: announcementAudience("audience").notNull().default("everyone"),
    priority: announcementPriority("priority").notNull().default("inbox"),
    status: announcementStatus("status").notNull().default("draft"),
    /** When it appears in inboxes (set on publish; a future time means scheduled). */
    publishAt: timestamp("publish_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("announcements_status_publish_idx").on(t.status, t.publishAt)],
);

/** Recipients of an announcement whose audience is "users". */
export const announcementRecipients = pgTable(
  "announcement_recipients",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] }), index("announcement_recipients_user_idx").on(t.userId)],
);

/** One row per user per announcement: the first time they read (or dismissed) it. */
export const announcementReads = pgTable(
  "announcement_reads",
  {
    announcementId: uuid("announcement_id")
      .notNull()
      .references(() => announcements.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.announcementId, t.userId] }), index("announcement_reads_user_idx").on(t.userId)],
);

// ---------------------------------------------------------------- Evo engines (the app is the gateway and scheduler)

/** Last known health of each configured engine, plus the admin's drain switch. Rows mirror EVO_ENGINES. */
export const evoEngines = pgTable("evo_engines", {
  id: text("id").primaryKey(),
  url: text("url").notNull(),
  /** Takes no new jobs; finishes the active ones. */
  draining: boolean("draining").notNull().default(false),
  /** Result of the latest health check. */
  healthy: boolean("healthy").notNull().default(true),
  lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }),
  /** Last time the engine answered its health check. */
  lastOkAt: timestamp("last_ok_at", { withTimezone: true }),
  lastError: text("last_error"),
  activeJobs: integer("active_jobs").notNull().default(0),
  queueDepth: integer("queue_depth").notNull().default(0),
  maxExtractions: integer("max_extractions").notNull().default(1),
  freeDiskGb: real("free_disk_gb"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Which engine owns each task. Never moves: a retry elsewhere is a new task. */
export const evoTasks = pgTable(
  "evo_tasks",
  {
    taskId: text("task_id").primaryKey(),
    engineId: text("engine_id").notNull(),
    kind: text("kind").notNull(),
    claimKey: text("claim_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("evo_tasks_engine_idx").on(t.engineId, t.createdAt)],
);

/**
 * One row per job identity (title + quality, or a title's Sinhala subtitles): the engine chosen for it.
 * Inserted atomically (ON CONFLICT DO NOTHING) so concurrent requests, from any app instance, agree on one engine.
 */
export const evoClaims = pgTable("evo_claims", {
  key: text("key").primaryKey(),
  engineId: text("engine_id").notNull(),
  taskId: text("task_id"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Engine holding each of its own subtitle ids, so a subtitle request reaches the right one. */
export const evoSubtitleOwners = pgTable("evo_subtitle_owners", {
  subId: text("sub_id").primaryKey(),
  engineId: text("engine_id").notNull(),
});

// ---------------------------------------------------------------- Error tracking

export const errorStatus = pgEnum("error_status", ["unresolved", "resolved", "ignored"]);

/** One stack frame after source-map resolution. `inApp` is our own code (not node_modules or framework internals). */
export type ErrorFrame = { fn: string; file: string; line: number | null; col: number | null; inApp: boolean; context?: { start: number; lines: string[] } };
export type Breadcrumb = { t: number; type: "nav" | "click" | "fetch" | "console" | "log"; message: string; level?: "info" | "warning" | "error" };

/** An issue groups every event with the same fingerprint (error type + normalised message + top in-app frame). */
export const errorIssues = pgTable(
  "error_issues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fingerprint: text("fingerprint").notNull().unique(),
    /** "server", "client" or "engine". */
    source: text("source").notNull(),
    type: text("type").notNull(),
    message: text("message").notNull(),
    /** Where it happened: the top in-app frame ("fn (file:line)") or the route. */
    culprit: text("culprit").notNull().default(""),
    level: text("level").notNull().default("error"),
    status: errorStatus("status").notNull().default("unresolved"),
    count: integer("count").notNull().default(0),
    firstSeen: timestamp("first_seen", { withTimezone: true }).notNull().defaultNow(),
    lastSeen: timestamp("last_seen", { withTimezone: true }).notNull().defaultNow(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    firstRelease: text("first_release"),
    lastRelease: text("last_release"),
    /** Last alert sent for this issue, so a noisy issue does not flood the inbox. */
    alertedAt: timestamp("alerted_at", { withTimezone: true }),
  },
  (t) => [index("error_issues_status_last_idx").on(t.status, t.lastSeen)],
);

/** A sample occurrence with its full context. Only the newest events per issue are kept (see lib/errors/store.ts). */
export const errorEvents = pgTable(
  "error_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    issueId: uuid("issue_id")
      .notNull()
      .references(() => errorIssues.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    message: text("message").notNull(),
    stack: text("stack").notNull().default(""),
    frames: jsonb("frames").$type<ErrorFrame[]>().notNull().default(sql`'[]'::jsonb`),
    url: text("url"),
    method: text("method"),
    route: text("route"),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    userEmail: text("user_email"),
    userAgent: text("user_agent"),
    release: text("release"),
    environment: text("environment"),
    breadcrumbs: jsonb("breadcrumbs").$type<Breadcrumb[]>().notNull().default(sql`'[]'::jsonb`),
    /** Everything else: tags, scrubbed request headers, digest, component stack, runtime. */
    context: jsonb("context").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  },
  (t) => [index("error_events_issue_created_idx").on(t.issueId, t.createdAt), index("error_events_user_idx").on(t.userId)],
);

/** Exact per-day counts (events are sampled, these are not), for trend charts. Days are Asia/Colombo. */
export const errorIssueDays = pgTable(
  "error_issue_days",
  {
    issueId: uuid("issue_id")
      .notNull()
      .references(() => errorIssues.id, { onDelete: "cascade" }),
    day: date("day").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.issueId, t.day] })],
);

// ---------------------------------------------------------------- Player feedback

/** Emoji survey answers from the player (1 = terrible ... 5 = loved it), with the playback context they were given in. */
export const playerFeedback = pgTable(
  "player_feedback",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    movieId: uuid("movie_id").references(() => movies.id, { onDelete: "set null" }),
    episodeId: uuid("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    /** Stable title key ("movie:<uuid>", "tv:<tmdbId>:<s>:<e>"...), also for titles not in the catalog yet. */
    mediaKey: text("media_key").notNull(),
    title: text("title").notNull(),
    rating: integer("rating").notNull(),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    comment: text("comment").notNull().default(""),
    positionSeconds: integer("position_seconds"),
    durationSeconds: integer("duration_seconds"),
    quality: text("quality"),
    /** Times playback stalled (buffering) during this viewing before the answer. */
    stalls: integer("stalls"),
    /** What opened the survey: "pause", "ended" or "playing". */
    trigger: text("trigger"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("player_feedback_rating_chk", sql`${t.rating} between 1 and 5`),
    index("player_feedback_created_idx").on(t.createdAt),
    index("player_feedback_user_created_idx").on(t.userId, t.createdAt),
    index("player_feedback_media_idx").on(t.mediaKey),
  ],
);

/**
 * Small questions the player may ask after a "moment" (a viewer picked a subtitle, finished a film...). Code fires
 * moments; which question goes with a moment, its wording, sample and target are edited in the admin.
 */
export const feedbackQuestions = pgTable(
  "feedback_questions",
  {
    key: text("key").primaryKey(),
    /** Which moment in the player asks it ("experience", "subtitle_picked", ...). */
    moment: text("moment").notNull(),
    /** "thumbs" (👍/👎) or "faces" (1-5). */
    kind: text("kind").notNull(),
    prompt: text("prompt").notNull(),
    /** Chips offered after a negative answer. */
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    /** Percent of eligible viewers who get asked. */
    sampleRate: integer("sample_rate").notNull().default(100),
    /** Stop asking after this many answers (null = keep asking). */
    target: integer("target"),
    /** Higher wins when several questions share a moment. */
    priority: integer("priority").notNull().default(0),
    /** "user": ask each viewer once; "title": once per viewer and title. */
    once: text("once").notNull().default("user"),
    active: boolean("active").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("feedback_questions_kind_chk", sql`${t.kind} in ('thumbs', 'faces')`),
    check("feedback_questions_once_chk", sql`${t.once} in ('user', 'title')`),
    check("feedback_questions_sample_chk", sql`${t.sampleRate} between 0 and 100`),
  ],
);

/** Every time a question was shown, and the answer if one came. The shared attention budget is counted from here. */
export const feedbackAsks = pgTable(
  "feedback_asks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    questionKey: text("question_key")
      .notNull()
      .references(() => feedbackQuestions.key, { onDelete: "cascade", onUpdate: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mediaKey: text("media_key").notNull(),
    title: text("title").notNull().default(""),
    /** "shown" until the viewer answers or lets it go. */
    outcome: text("outcome").notNull().default("shown"),
    /** Thumbs: 1 = 👍, 0 = 👎. Faces: 1-5. The "experience" answer itself lives in player_feedback. */
    value: integer("value"),
    reasons: text("reasons").array().notNull().default(sql`'{}'::text[]`),
    comment: text("comment").notNull().default(""),
    /** What the player knew when asking: quality, stalls, position, subtitle source... */
    context: jsonb("context").$type<Record<string, string | number | boolean | null>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("feedback_asks_outcome_chk", sql`${t.outcome} in ('shown', 'answered', 'ignored')`),
    index("feedback_asks_user_created_idx").on(t.userId, t.createdAt),
    index("feedback_asks_question_idx").on(t.questionKey, t.outcome),
  ],
);

/** A viewer who said "don't ask me". */
export const feedbackPrefs = pgTable("feedback_prefs", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  optedOut: boolean("opted_out").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// ---------------------------------------------------------------- Support chat
export const supportConversations = pgTable("support_conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique().references(() => users.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("open"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [check("support_status_check", sql`${t.status} in ('open', 'resolved')`), index("support_updated_idx").on(t.updatedAt)]);

export const supportMessages = pgTable("support_messages", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  conversationId: uuid("conversation_id").notNull().references(() => supportConversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  senderRole: text("sender_role").notNull(),
  clientId: uuid("client_id").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("support_sender_role_check", sql`${t.senderRole} in ('user', 'admin')`),
  check("support_text_check", sql`length(trim(${t.text})) between 1 and 2000`),
  unique("support_message_retry_uq").on(t.conversationId, t.senderId, t.clientId),
  index("support_messages_thread_idx").on(t.conversationId, t.id),
  index("support_messages_sender_idx").on(t.senderId, t.createdAt),
]);

export const supportReadStates = pgTable("support_read_states", {
  conversationId: uuid("conversation_id").notNull().references(() => supportConversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  lastMessageId: bigint("last_message_id", { mode: "number" }).notNull().default(0),
}, (t) => [primaryKey({ columns: [t.conversationId, t.userId] })]);
