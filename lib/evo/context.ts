import { eq } from "drizzle-orm";
import { db } from "@/db";
import { episodes, movies, seasons, shows, type CastMember } from "@/db/schema";
import { getImdbId } from "@/lib/tmdb";
import { ensureEpisode, ensureMovie } from "./ensure";

/** What the engine needs to know about a title besides its TMDB id. */
export type TitleContext = {
  runtimeMinutes: number | null;
  /** Plot summary, context for the Sinhala translation. */
  synopsis: string;
  /** Character names (not actor names), they anchor Sinhala spellings in the translation. */
  characters: string[];
  /** Canonical (TMDB) title; providers name titles after their own site. */
  title: string;
  /** Without an IMDb id there are no subtitles (and nothing to translate). */
  imdbId: string | null;
};

const characterNames = (cast: CastMember[]) =>
  [...new Set(cast.map((c) => c.character.replace(/\s*\((?:voice|uncredited|archive footage)[^)]*\)/gi, "").trim()).filter(Boolean))].slice(0, 12);

/**
 * Catalog row (created from TMDB when missing) plus the metadata the engine uses. Returns null when the episode
 * does not exist; throws TmdbError when TMDB has no such title.
 */
export async function titleContext(mediaType: "movie" | "tv", tmdbId: number, season?: number, episode?: number): Promise<TitleContext | null> {
  let ctx: Omit<TitleContext, "imdbId">;
  if (mediaType === "movie") {
    const id = await ensureMovie(tmdbId);
    const [m] = await db.select({ r: movies.runtimeMinutes, overview: movies.overview, cast: movies.cast, title: movies.title }).from(movies).where(eq(movies.id, id)).limit(1);
    ctx = { runtimeMinutes: m?.r ?? null, synopsis: m?.overview ?? "", characters: characterNames(m?.cast ?? []), title: m?.title ?? "" };
  } else {
    const ep = await ensureEpisode(tmdbId, season!, episode!);
    if (!ep) return null;
    const [row] = await db
      .select({ r: episodes.runtimeMinutes, epOverview: episodes.overview, showOverview: shows.overview, cast: shows.cast, showName: shows.name })
      .from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId))
      .innerJoin(shows, eq(shows.id, seasons.showId))
      .where(eq(episodes.id, ep.episodeId))
      .limit(1);
    ctx = {
      runtimeMinutes: row?.r ?? null,
      synopsis: [row?.showOverview, row?.epOverview].filter(Boolean).join(" "),
      characters: characterNames(row?.cast ?? []),
      title: row?.showName ?? "",
    };
  }
  const imdbId = await getImdbId(mediaType, tmdbId).catch(() => null);
  return { ...ctx, imdbId };
}
