import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import { tzDay } from '@/lib/tz';

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle>, tmdb: vi.fn(), season: vi.fn(), videos: vi.fn(async () => []), queries: [] as string[] }));
vi.mock('@/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === 'function' ? value.bind(state.db) : value; } }) }));
vi.mock('next/cache', () => ({ cacheTag: () => {} }));
vi.mock('@/lib/viewer/cache', () => ({ catalogCache: () => {}, titleTag: (kind: string, id: string) => `catalog:${kind}:${id}`, tmdbTag: (kind: string, id: number) => `tmdb:${kind}:${id}` }));
vi.mock('@/lib/cms/shows', () => ({ findShowIdByTmdb: async () => null }));
vi.mock('@/lib/cms/movies', () => ({ findMovieIdByTmdb: async () => null }));
vi.mock('@/lib/tmdb', () => ({ getShowSummary: state.tmdb, getShowSeason: state.season, getMovieSummary: vi.fn(), getViewerTmdbVideos: state.videos }));

import { firstEpisode, getShowDetail, getShowHero, getMovieDetail, getDetailVideos } from '@/lib/viewer/detail';
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
  state.db = drizzle(pg, { logger: { logQuery: (query: string) => { state.queries.push(query); } } });
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
    state.tmdb.mockResolvedValue({ name: 'TMDB show', videos: [], lastEpisode: { seasonNumber: 1, episodeNumber: 5 }, seasons: [{ seasonNumber: 1, episodeCount: 10 }, { seasonNumber: 2, airDate: future, episodeCount: 1 }] });
    state.season.mockImplementation(async (_id: number, season: number) => season === 1 ? episodes : [{ ...episodes[5], episodeNumber: 1 }]);
    const show = await getShowDetail('tmdb-2', 2);
    expect(show?.seasons[0]).toMatchObject({ episodeCount: 10, upcomingCount: 5, firstEpisode: 1 });
    expect(show?.selected?.firstEpisode).toBeNull();
    expect(show?.first).toEqual({ seasonNumber: 1, episodeNumber: 1 });
    const watch = await getEpisodeWatch('tmdb-2', 1, 5);
    expect(watch?.next).toBeNull();
    expect(watch?.seasonEpisodes).toHaveLength(10);
  });

  it('loads a single season and keeps episode overviews out of the DB sidebar query', async () => {
    state.queries.length = 0;
    const watch = await getEpisodeWatch(showId, 1, 3);
    expect(watch?.current).toMatchObject({ episodeNumber: 3 });
    expect(watch?.prev?.episodeNumber).toBe(2);
    expect(watch?.next?.episodeNumber).toBe(4);
    const sidebar = state.queries.find((q) => q.includes('from "episodes"') && !q.includes('join'));
    expect(sidebar).toContain('"season_id" =');
    expect(sidebar).not.toContain('"overview"');
    const neighbors = state.queries.filter((q) => q.includes('from "seasons"') && q.includes('limit'));
    expect(neighbors).toHaveLength(2);
    expect(neighbors.every((q) => q.includes('air_date') && q.includes('is_visible'))).toBe(true);
  });

  it('navigates across hidden and empty seasons with bounded aired-episode queries', async () => {
    const [hidden, empty, later] = await state.db.insert(schema.seasons).values([
      { showId, seasonNumber: 3, isVisible: false }, { showId, seasonNumber: 4 }, { showId, seasonNumber: 5 },
    ]).returning();
    await state.db.insert(schema.episodes).values([
      { seasonId: hidden.id, episodeNumber: 1, airDate: today },
      { seasonId: later.id, episodeNumber: 1, airDate: today, isVisible: false },
      { seasonId: later.id, episodeNumber: 2, airDate: today },
    ]);
    expect((await getEpisodeWatch(showId, 1, 5))?.next).toMatchObject({ seasonNumber: 5, episodeNumber: 2 });
    expect((await getEpisodeWatch(showId, 5, 2))?.prev).toMatchObject({ seasonNumber: 1, episodeNumber: 5 });
    expect(await getEpisodeWatch(showId, hidden.seasonNumber, 1)).toBeNull();
    expect(await getEpisodeWatch(showId, empty.seasonNumber, 1)).toBeNull();
    expect(await getEpisodeWatch(showId, 5, 1)).toBeNull();
  });

  it('does not fetch a season for the TMDB hero or fetch unrelated seasons for detail/watch', async () => {
    const ep = (n: number) => ({ episodeNumber: n, airDate: today, name: `Episode ${n}`, overview: 'Summary', stillPath: null, runtimeMinutes: null });
    state.tmdb.mockResolvedValue({ name: 'Long show', videos: [], lastEpisode: { seasonNumber: 20, episodeNumber: 3 }, seasons: Array.from({ length: 20 }, (_, i) => ({ seasonNumber: i + 1, episodeCount: 3, name: `Season ${i + 1}`, airDate: today })) });
    state.season.mockImplementation(async () => [ep(1), ep(2), ep(3)]);
    state.season.mockClear();
    expect(await getShowHero('tmdb-88')).not.toBeNull();
    expect(state.season).not.toHaveBeenCalled();
    await getShowDetail('tmdb-88', 10);
    expect(state.season.mock.calls).toEqual([[88, 10]]);
    state.season.mockClear();
    const watch = await getEpisodeWatch('tmdb-88', 10, 2);
    expect(watch?.prev?.episodeNumber).toBe(1);
    expect(watch?.next?.episodeNumber).toBe(3);
    expect(state.season.mock.calls).toEqual([[88, 10]]);
    state.season.mockClear();
    expect((await getEpisodeWatch('tmdb-88', 10, 3))?.next).toMatchObject({ seasonNumber: 11, episodeNumber: 1 });
    expect(state.season.mock.calls).toEqual([[88, 10], [88, 11]]);
  });


  it('returns movie metadata without waiting for TMDB trailer fallback', async () => {
    const [movie] = await state.db.insert(schema.movies).values({ tmdbId: 99, title: 'Movie without videos', isPublished: true }).returning();
    state.videos.mockClear();
    const detail = await getMovieDetail(movie.id);
    expect(detail).toMatchObject({ videos: [], playable: true, isEvo: true, dubs: [] });
    expect(state.videos).not.toHaveBeenCalled();
    await getDetailVideos('movie', movie.id, 99, detail!.videos);
    expect(state.videos).toHaveBeenCalledWith('movie', 99);
  });


  it('counts blank-language active sources as playable without presenting a dub', async () => {
    const [movie] = await state.db.insert(schema.movies).values({ tmdbId: 100, title: 'Local movie', isPublished: true }).returning();
    await state.db.insert(schema.sources).values({ movieId: movie.id, label: 'Source', kind: 'direct', url: 'https://example.invalid/video.mp4' });
    expect(await getMovieDetail(movie.id)).toMatchObject({ playable: true, isEvo: false, dubs: [] });
    await state.db.update(schema.sources).set({ isActive: false }).where(eq(schema.sources.movieId, movie.id));
    expect(await getMovieDetail(movie.id)).toMatchObject({ playable: true, isEvo: true, dubs: [] });
  });

  it('keeps unpublished titles unavailable in the narrowed reads', async () => {
    const [show] = await state.db.insert(schema.shows).values({ tmdbId: 101, name: 'Unpublished', isPublished: false }).returning();
    const [season] = await state.db.insert(schema.seasons).values({ showId: show.id, seasonNumber: 1 }).returning();
    await state.db.insert(schema.episodes).values({ seasonId: season.id, episodeNumber: 1 });
    expect(await getShowHero(show.id)).toBeNull();
    expect(await getEpisodeWatch(show.id, 1, 1)).toBeNull();
  });

  it('keeps the current TMDB episode playable when the adjacent season endpoint fails', async () => {
    const ep = { episodeNumber: 1, airDate: today, name: 'Only episode', overview: '', runtimeMinutes: null, stillPath: null };
    state.tmdb.mockResolvedValue({ name: 'Show', videos: [], seasons: [{ seasonNumber: 1, episodeCount: 1 }, { seasonNumber: 2, episodeCount: 1 }] });
    state.season.mockImplementation(async (_id: number, season: number) => {
      if (season === 2) throw new Error('Unavailable');
      return [ep];
    });
    const watch = await getEpisodeWatch('tmdb-89', 1, 1);
    expect(watch?.current.episodeNumber).toBe(1);
    expect(watch?.next).toBeNull();
  });

});
