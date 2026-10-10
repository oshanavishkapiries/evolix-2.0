import { z } from "zod";
import { VIDEO_SITES, VIDEO_TYPES, isValidKey } from "@/lib/videos";

const text = (max = 5000) => z.string().trim().max(max);
const date = z.iso.date().nullable();
const path = z
  .string()
  .trim()
  .regex(/^\/[\w\-./]+$/, "Must be a TMDB image path like /abc.jpg")
  .max(255)
  .nullable();
const intNull = z.number().int().min(0).max(10_000_000).nullable();

export const castSchema = z
  .array(
    z.object({
      name: text(200),
      character: text(200).default(""),
      profilePath: path.default(null),
    }),
  )
  .max(50);

// ---- videos

const KEY_MSG = "Invalid video key for this site";
const videoFields = {
  site: z.enum(VIDEO_SITES),
  key: z.string().trim().min(1).max(50),
  name: text(300).min(1),
  type: z.enum(VIDEO_TYPES),
  official: z.boolean().default(false),
  language: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z]{2}$/, "Use a 2-letter ISO 639-1 code")
    .nullable()
    .or(z.literal("").transform(() => null))
    .default(null),
  publishedAt: z.iso.datetime({ offset: true }).nullable().default(null),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
  isVisible: z.boolean().default(true),
};
const keyOk = (v: { site: "youtube" | "vimeo"; key: string }) => isValidKey(v.site, v.key);
const videoNested = z.object(videoFields).refine(keyOk, { message: KEY_MSG, path: ["key"] });

const movieFields = {
  title: text(500).min(1),
  originalTitle: text(500).default(""),
  tagline: text(1000).default(""),
  overview: text().default(""),
  releaseDate: date.default(null),
  runtimeMinutes: intNull.default(null),
  genres: z.array(text(100).min(1)).max(40).default([]),
  rating: z.number().min(0).max(10).nullable().default(null),
  voteCount: intNull.default(null),
  originalLanguage: text(20).default(""),
  status: text(100).default(""),
  posterPath: path.default(null),
  backdropPath: path.default(null),
  cast: castSchema.default([]),
  isPublished: z.boolean().default(false),
};
const tmdbId = z.number().int().positive();

export const movieCreate = z.object({ tmdbId, ...movieFields, videos: z.array(videoNested).max(100).default([]) });
export const moviePatch = z.object(movieFields).partial().strict();

const showFields = {
  name: text(500).min(1),
  originalName: text(500).default(""),
  tagline: text(1000).default(""),
  overview: text().default(""),
  firstAirDate: date.default(null),
  lastAirDate: date.default(null),
  status: text(100).default(""),
  genres: z.array(text(100).min(1)).max(40).default([]),
  rating: z.number().min(0).max(10).nullable().default(null),
  voteCount: intNull.default(null),
  originalLanguage: text(20).default(""),
  posterPath: path.default(null),
  backdropPath: path.default(null),
  cast: castSchema.default([]),
  isPublished: z.boolean().default(false),
};

const episodeFields = {
  name: text(500).default(""),
  overview: text().default(""),
  airDate: date.default(null),
  runtimeMinutes: intNull.default(null),
  stillPath: path.default(null),
  isVisible: z.boolean().default(true),
};
const seasonFields = {
  name: text(500).default(""),
  overview: text().default(""),
  airDate: date.default(null),
  posterPath: path.default(null),
  isVisible: z.boolean().default(true),
};

const episodeCreate = z.object({
  tmdbId: tmdbId.nullable().default(null),
  episodeNumber: z.number().int().min(0).max(100_000),
  ...episodeFields,
});
const seasonCreate = z.object({
  tmdbId: tmdbId.nullable().default(null),
  seasonNumber: z.number().int().min(0).max(10_000),
  ...seasonFields,
  episodes: z.array(episodeCreate).max(2000).default([]),
});

const unique = (nums: number[]) => new Set(nums).size === nums.length;

export const showCreate = z
  .object({ tmdbId, ...showFields, seasons: z.array(seasonCreate).max(200).default([]),
    videos: z.array(videoNested).max(100).default([]),
  })
  .refine((s) => unique(s.seasons.map((x) => x.seasonNumber)), "Duplicate season numbers")
  .refine(
    (s) => s.seasons.every((x) => unique(x.episodes.map((e) => e.episodeNumber))),
    "Duplicate episode numbers within a season",
  );
export const showPatch = z.object(showFields).partial().strict();
export const seasonPatch = z
  .object({ seasonNumber: z.number().int().min(0).max(10_000), ...seasonFields })
  .partial()
  .strict();
export const episodePatch = z
  .object({ episodeNumber: z.number().int().min(0).max(100_000), ...episodeFields })
  .partial()
  .strict();

// ---- sources / subtitles

/** Absolute http(s) URL only; never fetched server-side. */
export const urlSchema = z
  .string()
  .trim()
  .min(1)
  .max(2048)
  .refine((v) => /^https?:\/\/[^\s]+$/i.test(v) && URL.canParse(v), "Must be an absolute http(s) URL");

export const KINDS = ["direct", "hls", "embed"] as const;
export type Kind = (typeof KINDS)[number];

/** Embeds are rendered in an iframe on the site, so they must be https. */
export const embedIsHttps = (kind: string, url: string) =>
  kind !== "embed" || /^https:\/\//i.test(url);
const EMBED_MSG = "Embed URLs must use https";

const parent = {
  movieId: z.uuid().optional(),
  episodeId: z.uuid().optional(),
};
const exactlyOne = (v: { movieId?: string; episodeId?: string }) =>
  (v.movieId === undefined) !== (v.episodeId === undefined);
const PARENT_MSG = "Provide exactly one of movieId or episodeId";

const sourceFields = {
  label: text(200).min(1),
  kind: z.enum(KINDS),
  url: urlSchema,
  quality: text(50).nullable().default(null).transform((v) => v || null),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
  isActive: z.boolean().default(true),
};
export const sourceCreate = z
  .object({ ...parent, ...sourceFields })
  .refine(exactlyOne, PARENT_MSG)
  .refine((v) => embedIsHttps(v.kind, v.url), { message: EMBED_MSG, path: ["url"] });
export const sourcePatch = z.object(sourceFields).partial().strict();

export const FORMATS = ["vtt", "srt"] as const;
const subtitleFields = {
  label: text(200).min(1),
  language: text(35).min(1),
  url: urlSchema,
  format: z.enum(FORMATS),
  sortOrder: z.number().int().min(-100000).max(100000).default(0),
};
export const subtitleCreate = z.object({ ...parent, ...subtitleFields }).refine(exactlyOne, PARENT_MSG);
export const subtitlePatch = z.object(subtitleFields).partial().strict();

export const parentQuery = z
  .object({ movieId: z.uuid().optional(), episodeId: z.uuid().optional() })
  .refine(exactlyOne, PARENT_MSG);

export const EMBED_ERROR = EMBED_MSG;

export const videoCreate = z
  .object({
    movieId: z.uuid().optional(),
    showId: z.uuid().optional(),
    ...videoFields,
    // Omitted: the video is appended after the current last one.
    sortOrder: z.number().int().min(-100000).max(100000).optional(),
  })
  .refine((v) => (v.movieId === undefined) !== (v.showId === undefined), "Provide exactly one of movieId or showId")
  .refine(keyOk, { message: KEY_MSG, path: ["key"] });
export const videoPatch = z.object(videoFields).partial().strict();
export const VIDEO_KEY_ERROR = KEY_MSG;
export const videoParentQuery = z
  .object({ movieId: z.uuid().optional(), showId: z.uuid().optional() })
  .refine((v) => (v.movieId === undefined) !== (v.showId === undefined), "Provide exactly one of movieId or showId");
export const videoImport = videoParentQuery;
export type VideoNested = z.infer<typeof videoNested>;
