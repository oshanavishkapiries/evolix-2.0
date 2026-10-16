import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
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
/** Where a title is listed: the main app, the Kids section only, or both. */
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
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("subtitles_movie_id_idx").on(t.movieId),
    index("subtitles_episode_id_idx").on(t.episodeId),
    // One track per language: Evo subtitle sync upserts on these.
    unique("subtitles_movie_language_uq").on(t.movieId, t.language),
    unique("subtitles_episode_language_uq").on(t.episodeId, t.language),
    check(
      "subtitles_one_parent_chk",
      sql`(${t.movieId} is null) <> (${t.episodeId} is null)`,
    ),
  ],
);

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
