import { eq } from "drizzle-orm";
import { revalidateTag } from "next/cache";
import type { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { episodes, movies, seasons, shows, sources, subtitles, videos } from "@/db/schema";
import { CATALOG_TAG, catalogListTag, titleTag, tmdbTag } from "@/lib/viewer/cache";
import { invalidateTitleVisibility } from "@/lib/viewer/exists";

type Parent = { movieId?: string | null; showId?: string | null; episodeId?: string | null; seasonId?: string | null };
type Title = { kind: "movie" | "show"; id: string };

/** Resolve children before deletion, while their parent links still exist. */
export async function catalogTitle(parent: Parent): Promise<Title | null> {
  if (parent.movieId) return { kind: "movie", id: parent.movieId };
  if (parent.showId) return { kind: "show", id: parent.showId };
  if (parent.episodeId) {
    const [row] = await db.select({ showId: seasons.showId }).from(episodes)
      .innerJoin(seasons, eq(seasons.id, episodes.seasonId)).where(eq(episodes.id, parent.episodeId)).limit(1);
    return row ? { kind: "show", id: row.showId } : null;
  }
  if (parent.seasonId) {
    const [row] = await db.select({ showId: seasons.showId }).from(seasons).where(eq(seasons.id, parent.seasonId)).limit(1);
    return row ? { kind: "show", id: row.showId } : null;
  }
  return null;
}

export async function invalidateCatalogParent(parent: Parent, immediate = true) {
  const title = await catalogTitle(parent);
  revalidateTag(title ? titleTag(title.kind, title.id) : CATALOG_TAG, immediate ? { expire: 0 } : "max");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIST_FIELDS = new Set(["isPublished", "title", "name", "originalTitle", "originalName", "posterPath", "backdropPath", "logoPath", "genres", "rating", "voteCount", "releaseDate", "firstAirDate", "originalLanguage", "tmdbId"]);

/** Only catalog resources opt in; user/settings/support and operational writes do nothing. */
export async function prepareCatalogInvalidation(req: NextRequest) {
  if (req.method === "GET" || req.method === "HEAD") return null;
  const match = /^\/api\/admin\/(movies|shows|seasons|episodes|sources|videos|subtitles)(?:\/([^/]+))?(.*)$/.exec(req.nextUrl.pathname);
  if (!match) return null;
  const [, resource, id, suffix] = match;
  if (suffix && suffix !== "/episodes" && suffix !== "/provider-import/commit") return null;
  if (id && !UUID.test(id) && !(resource === "videos" && id === "import-from-tmdb")) return null;
  let body: Record<string, unknown> = {};
  if (req.method !== "DELETE") {
    try { body = await req.clone().json(); } catch { /* Handler owns validation. */ }
    if (!body || typeof body !== "object") body = {};
  }
  let title: Title | null = null;
  let tmdbId: number | undefined;
  const root = resource === "movies" || resource === "shows";
  if (root && id) {
    title = { kind: resource === "movies" ? "movie" : "show", id };
    const table = resource === "movies" ? movies : shows;
    const [row] = await db.select({ tmdbId: table.tmdbId }).from(table).where(eq(table.id, id)).limit(1);
    tmdbId = row?.tmdbId;
  } else if (id && UUID.test(id)) {
    if (resource === "seasons") title = await catalogTitle({ seasonId: id });
    else if (resource === "episodes") title = await catalogTitle({ episodeId: id });
    else {
      const table = resource === "sources" ? sources : resource === "videos" ? videos : subtitles;
      const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1);
      if (row) title = await catalogTitle(row);
    }
  } else if (!root) {
    title = await catalogTitle({
      movieId: typeof body.movieId === "string" && UUID.test(body.movieId) ? body.movieId : null,
      showId: typeof body.showId === "string" && UUID.test(body.showId) ? body.showId : null,
      episodeId: typeof body.episodeId === "string" && UUID.test(body.episodeId) ? body.episodeId : null,
    });
  }
  const list = root && (!id || req.method === "DELETE" || Object.keys(body).some((key) => LIST_FIELDS.has(key)));
  const immediate = req.method === "DELETE" || resource === "sources" || resource === "subtitles" || "isPublished" in body || "isVisible" in body; // visibility flips both ways must not serve a stale page
  return async (res: NextResponse) => {
    if (!res.ok) return;
    if (root && !id) {
      const data = await res.clone().json();
      const createdId = resource === "movies" ? data.movie?.id : data.id;
      if (typeof createdId === "string") title = { kind: resource === "movies" ? "movie" : "show", id: createdId };
      if (typeof body.tmdbId === "number") tmdbId = body.tmdbId;
    }
    const profile = immediate ? { expire: 0 } : "max";
    revalidateTag(title ? titleTag(title.kind, title.id) : CATALOG_TAG, profile);
    if (list) revalidateTag(catalogListTag, profile);
    if (title) {
      // Clear episode decisions too when a season or the title changes visibility.
      invalidateTitleVisibility(title.kind, title.id);
      const tmdbIds = new Set([tmdbId, typeof body.tmdbId === "number" ? body.tmdbId : undefined]);
      for (const value of tmdbIds) {
        if (value !== undefined) revalidateTag(tmdbTag(title.kind === "movie" ? "movie" : "tv", value), profile);
      }
    }
  };
}
