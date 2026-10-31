import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { tzDay } from '@/lib/tz';

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle>, tmdb: vi.fn() }));
vi.mock('@/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === 'function' ? value.bind(state.db) : value; } }) }));
vi.mock('@/lib/viewer/cache', () => ({ catalogCache: () => {} }));
vi.mock('@/lib/cms/shows', () => ({ findShowIdByTmdb: async () => null }));
vi.mock('@/lib/cms/movies', () => ({ findMovieIdByTmdb: async () => null }));
vi.mock('@/lib/tmdb', () => ({ getShowDetails: state.tmdb, getMovieDetails: vi.fn(), getTmdbVideos: async () => [] }));

import { firstEpisode, getShowDetail } from '@/lib/viewer/detail';
import { getEpisodeWatch } from '@/lib/viewer/watch';
import { continueWatching } from '@/lib/viewer/library';

let pg: PGlite;
const showId = randomUUID();
const userId = randomUUID();
const today = tzDay(new Date());
const future = '2099-01-01';
let episodeIds: string[];

beforeAll(async () => {
  // An isolated in-memory Postgres database; never connects to DATABASE_URL.
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  }
  state.db = drizzle(pg);
  await state.db.insert(schema.users).values({ id: userId, email: 'viewer@test.invalid', passwordHash: 'unused' });
  await state.db.insert(schema.shows).values({ id: showId, tmdbId: 1, name: 'Weekly show', isPublished: true });
  const [season] = await state.db.insert(schema.seasons).values({ showId, seasonNumber: 1 }).returning();
  const rows = await state.db.insert(schema.episodes).values(Array.from({ length: 10 }, (_, i) => ({ seasonId: season.id, episodeNumber: i + 1, airDate: i < 5 ? today : future }))).returning();
  episodeIds = rows.map((e) => e.id);
  const [nextSeason] = await state.db.insert(schema.seasons).values({ showId, seasonNumber: 2, airDate: future }).returning();
  await state.db.insert(schema.episodes).values({ seasonId: nextSeason.id, episodeNumber: 1, airDate: future });
}, 30000);
afterAll(async () => { await pg?.close(); });

describe('catalog release rules against Postgres', () => {
  it('counts upcoming episodes separately and gives future seasons no play target', async () => {
    const show = await getShowDetail(showId, 1);
    expect(show?.seasons[0]).toMatchObject({ episodeCount: 10, upcomingCount: 5, firstEpisode: 1 });
    expect(show?.seasons[1]).toMatchObject({ episodeCount: 1, upcomingCount: 1, firstEpisode: null });
    expect(await firstEpisode(showId)).toEqual({ seasonNumber: 1, episodeNumber: 1 });
  });

  it('keeps all episodes in the panel while stopping Next after episode five', async () => {
    const watch = await getEpisodeWatch(showId, 1, 5);
    expect(watch?.seasonEpisodes).toHaveLength(10);
    expect(watch?.prev?.episodeNumber).toBe(4);
    expect(watch?.next).toBeNull();
    expect((await getEpisodeWatch(showId, 1, 6))?.current.airDate).toBe(future);
  });

  it('does not suggest an unaired episode in Continue Watching', async () => {
    await state.db.insert(schema.watchProgress).values({ userId, episodeId: episodeIds[4], completed: true, positionSeconds: 2400, durationSeconds: 2400 });
    expect(await continueWatching(userId)).toEqual([]);
    await state.db.update(schema.watchProgress).set({ episodeId: episodeIds[3] }).where(eq(schema.watchProgress.userId, userId));
    expect((await continueWatching(userId))[0]?.href).toBe(`/watch/tv/${showId}/1/5`);
  });

  it('applies the same navigation and season rules to TMDB-only shows', async () => {
    const episodes = Array.from({ length: 10 }, (_, i) => ({ episodeNumber: i + 1, airDate: i < 5 ? today : future, name: '', overview: '', stillPath: null, runtimeMinutes: null }));
    state.tmdb.mockResolvedValue({ name: 'TMDB show', videos: [], seasons: [{ seasonNumber: 1, episodes }, { seasonNumber: 2, airDate: future, episodes: [{ ...episodes[5], episodeNumber: 1 }] }] });
    const show = await getShowDetail('tmdb-2', 2);
    expect(show?.seasons[0]).toMatchObject({ episodeCount: 10, upcomingCount: 5, firstEpisode: 1 });
    expect(show?.selected?.firstEpisode).toBeNull();
    expect(show?.first).toEqual({ seasonNumber: 1, episodeNumber: 1 });
    const watch = await getEpisodeWatch('tmdb-2', 1, 5);
    expect(watch?.next).toBeNull();
    expect(watch?.seasonEpisodes).toHaveLength(10);
  });
});
