import { and, desc, eq, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { subtitles } from "@/db/schema";
import { ensureEpisode, ensureMovie } from "@/lib/evo/ensure";
import type { SubtitleTarget } from "./schema";
import { randomUUID } from "node:crypto";

export type Parent = { movieId: string; episodeId?: never } | { episodeId: string; movieId?: never };
export const visibleTo = (userId: string) => and(eq(subtitles.hidden, false), or(eq(subtitles.visibility, "shared"), eq(subtitles.uploadedBy, userId),
  sql`exists (select 1 from subtitle_grants g where g.user_id = ${userId}::uuid and (g.track_id = ${subtitles.id} or g.track_id = ${subtitles.originTrackId}))`));
export const inParent = (p: Parent) => p.movieId ? eq(subtitles.movieId, p.movieId) : eq(subtitles.episodeId, p.episodeId!);

export async function resolveParent(t: SubtitleTarget): Promise<Parent> {
  if (t.mediaType === "movie") return { movieId: await ensureMovie(t.tmdbId) };
  const ep = await ensureEpisode(t.tmdbId, t.season!, t.episode!);
  if (!ep) throw new Error("Episode not found");
  return { episodeId: ep.episodeId };
}

/** What a viewer may see of a track: never the uploader, the engine or provider references. */
export const publicTrack = (t: typeof subtitles.$inferSelect, userId: string) => ({
  id: t.id, label: t.label, language: t.language, format: t.format, url: t.url, source: t.source,
  originTrackId: t.originTrackId, visibility: t.visibility, score: t.score, lastUsedAt: t.lastUsedAt,
  canShare: t.uploadedBy === userId && t.source === "upload",
});

export function listTracks(parent: Parent, userId: string) {
  return db.select().from(subtitles).where(and(inParent(parent), visibleTo(userId)))
    .orderBy(desc(subtitles.score), sql`${subtitles.lastUsedAt} desc nulls last`, subtitles.id);
}

export async function accessibleTrack(id: string, userId: string) {
  const [row] = await db.select().from(subtitles).where(and(eq(subtitles.id, id), visibleTo(userId))).limit(1);
  return row ?? null;
}

export async function saveTrack(parent: Parent, track: Omit<typeof subtitles.$inferInsert, "movieId" | "episodeId">) {
  const [row] = await db.insert(subtitles).values({ ...parent, ...track }).onConflictDoUpdate({
    target: [parent.movieId ? subtitles.movieId : subtitles.episodeId, subtitles.language, subtitles.source, subtitles.originKey],
    targetWhere: parent.movieId ? sql`${subtitles.movieId} is not null` : sql`${subtitles.episodeId} is not null`,
    // A retry refreshes delivery details while preserving votes, reports and visibility.
    set: { url: track.url, label: track.label, ...(track.engineId ? { engineId: track.engineId } : {}) },
  }).returning();
  return row;
}

export async function reserveQuota(userId: string, mediaKey: string, kind: "upload" | "translation", limit: number): Promise<boolean> {
  const result = await db.execute(sql`
    insert into subtitle_quota (user_id, media_key, kind) values (${userId}::uuid, ${mediaKey}, ${kind})
    on conflict (user_id, media_key, kind, day) do update set used = subtitle_quota.used + 1
    where subtitle_quota.used < ${limit} returning used
  `);
  return result.rows.length > 0;
}

export async function recordActivity(userId: string, trackId: string, action: "start" | "played" | "good" | "report", reason?: string, playId?: string) {
  if (action === "start") {
    const id = playId ?? randomUUID();
    await db.execute(sql`insert into subtitle_plays (id, track_id, user_id) values (${id}::uuid, ${trackId}::uuid, ${userId}::uuid) on conflict do nothing`);
    return id;
  }
  if (action === "played") {
    if (!playId) return false;
    await db.execute(sql`
      with counted as (
        update subtitle_plays set completed_at = now()
        where id = ${playId}::uuid and track_id = ${trackId}::uuid and user_id = ${userId}::uuid and completed_at is null
          and started_at <= now() - interval '60 seconds'
          and not exists (select 1 from subtitle_activity where track_id = ${trackId}::uuid and user_id = ${userId}::uuid and problem is not null)
          -- One scoring play per viewer, track and day, so a single account cannot inflate a track's rank.
          and not exists (select 1 from subtitle_plays p where p.track_id = ${trackId}::uuid and p.user_id = ${userId}::uuid and p.completed_at > now() - interval '1 day')
        returning track_id, user_id
      ), remembered as (
        insert into subtitle_activity (track_id, user_id, played_at) select track_id, user_id, now() from counted
        on conflict (track_id, user_id) do update set played_at = coalesce(subtitle_activity.played_at, excluded.played_at)
      ) update subtitles set plays_ok = plays_ok + 1, score = score + 1, last_used_at = now()
        where id in (select track_id from counted)
    `);
    // Runs after the counted play is committed, so the third distinct viewer is visible to this query.
    await db.execute(sql`
      update subtitles s set visibility = 'shared'
      where s.id = ${trackId}::uuid and s.source = 'upload' and s.visibility = 'private' and s.reports = 0
        and (select count(*) from subtitle_activity a where a.track_id = s.id and a.played_at is not null and a.problem is null and a.user_id <> s.uploaded_by) >= 3
    `);
    await db.execute(sql`update subtitles t set visibility = 'shared' from subtitles s where t.origin_track_id = s.id and s.id = ${trackId}::uuid and s.visibility = 'shared' and t.visibility = 'private'`);
    const result = await db.execute(sql`select completed_at is not null as credited from subtitle_plays where id = ${playId}::uuid and track_id = ${trackId}::uuid and user_id = ${userId}::uuid`);
    return result.rows[0]?.credited === true;
  }
  if (action === "good") {
    await db.execute(sql`
      with counted as (
        insert into subtitle_activity (track_id, user_id, good) values (${trackId}::uuid, ${userId}::uuid, true)
        on conflict (track_id, user_id) do update set good = true where not subtitle_activity.good and subtitle_activity.problem is null
        returning track_id
      ) update subtitles set score = score + 1 where id in (select track_id from counted)
    `);
    return;
  }
  const result = await db.execute(sql`
    with counted as (
      insert into subtitle_activity (track_id, user_id, problem) values (${trackId}::uuid, ${userId}::uuid, ${reason ?? "out_of_sync"})
      on conflict (track_id, user_id) do update set problem = excluded.problem where subtitle_activity.problem is null
      returning track_id
    ) update subtitles set reports = reports + 1, score = score - 3, hidden = hidden or reports + 1 >= 3
      where id in (select track_id from counted) returning hidden, (select hidden from subtitles where id = ${trackId}::uuid) as was_hidden
  `);
  // Only a report that hides the track changes what cached watch pages show.
  return result.rows[0]?.hidden === true && result.rows[0]?.was_hidden !== true;
}
