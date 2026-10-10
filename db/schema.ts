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
export const subtitleFormat = pgEnum("subtitle_format", ["vtt", "srt"]);

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
  cast: jsonb("cast").$type<CastMember[]>().notNull().default(sql`'[]'::jsonb`),
  isPublished: boolean("is_published").notNull().default(false),
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
  cast: jsonb("cast").$type<CastMember[]>().notNull().default(sql`'[]'::jsonb`),
  isPublished: boolean("is_published").notNull().default(false),
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
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("sources_movie_id_idx").on(t.movieId),
    index("sources_episode_id_idx").on(t.episodeId),
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
    check(
      "subtitles_one_parent_chk",
      sql`(${t.movieId} is null) <> (${t.episodeId} is null)`,
    ),
  ],
);
