import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';
import type { TmdbCatalogItem } from '@/lib/tmdb';

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle>, trending: vi.fn(), discover: vi.fn(), searchMovies: vi.fn(), searchShows: vi.fn(), logo: vi.fn(), tags: vi.fn() }));
vi.mock('@/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === 'function' ? value.bind(state.db) : value; } }) }));
vi.mock('next/cache', () => ({ cacheTag: state.tags, cacheLife: vi.fn() }));
vi.mock('@/lib/errors/capture', () => ({ captureException: vi.fn() }));
vi.mock('@/lib/tmdb', () => ({ getTrendingMedia: state.trending, getDiscoverMedia: state.discover, searchMovies: state.searchMovies, searchShows: state.searchShows, getTmdbLogo: state.logo }));
import { browse, listFeatured, normalizeBrowse, SORTS } from '@/lib/viewer/catalog';

const item = (kind: 'movie' | 'tv', index: number): TmdbCatalogItem => ({
  tmdbId: (kind === 'movie' ? 1000 : 2000) + index,
  title: `${kind} ${index}`, date: `${2099 - index}-01-01`, posterPath: '/poster.jpg', backdropPath: '/backdrop.jpg', rating: 7, overview: '',
});
const totals = { movie: 65, tv: 43 };
const remote = (kind: 'movie' | 'tv', page: number) => ({
  page, totalPages: Math.ceil(totals[kind] / 20), totalResults: totals[kind],
  items: Array.from({ length: totals[kind] }, (_, i) => item(kind, i)).slice((page - 1) * 20, page * 20),
});
const ids = (items: { kind: string; id: string }[]) => items.map((i) => `${i.kind}:${i.id}`);
let pg: PGlite;
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  state.db = drizzle(pg);
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(async () => {
  await state.db.delete(schema.sources);
  await state.db.delete(schema.movies);
  vi.clearAllMocks();
  state.trending.mockImplementation(async (kind, _window, page) => remote(kind, page));
  state.discover.mockImplementation(async (kind, params) => remote(kind, params.page));
  for (const [mock, kind, count] of [[state.searchMovies, 'movie', 23], [state.searchShows, 'tv', 7]] as const) {
    mock.mockImplementation(async (_q, page) => ({ page, totalPages: Math.ceil(count / 20), totalResults: count, results: Array.from({ length: count }, (_, i) => ({ ...item(kind, i), year: 2099 - i })).slice((page - 1) * 20, page * 20) }));
  }
});

describe('P2-C hybrid browse pagination and sorting', () => {
  it('normalizes omitted/default/empty filters before the cache boundary', () => {
    expect(normalizeBrowse({})).toEqual(normalizeBrowse({ type: 'all', sort: 'newest', q: ' ', genre: '', offset: 0, limit: 24, withTotal: false, withBackdrop: false }));
    expect(normalizeBrowse({ q: ' x ', sort: 'title' })).toEqual(normalizeBrowse({}));
  });

  it('fills 24-result single-kind pages across upstream 20-result boundaries', async () => {
    const a = await browse({ type: 'movie', limit: 24 });
    const b = await browse({ type: 'movie', limit: 24, offset: 24 });
    expect([...a.items, ...b.items].map((i) => i.title)).toEqual(Array.from({ length: 48 }, (_, i) => `movie ${i}`));
    expect(a.total).toBe(65);
    expect(state.tags).toHaveBeenCalledWith('catalog:list', 'catalog');
  });

  it('uses a stable mixed sequence across page sizes and drains the longer stream', async () => {
    const whole = await browse({ limit: 100 });
    const tail = await browse({ limit: 24, offset: 100 });
    const pages = await Promise.all([0, 24, 48, 72, 96].map((offset) => browse({ limit: 24, offset })));
    const actual = pages.flatMap((p) => ids(p.items));
    expect(actual).toEqual(ids([...whole.items, ...tail.items]));
    expect(new Set(actual).size).toBe(108);
    expect(pages[0].items.slice(0, 4).map((i) => i.title)).toEqual(['movie 0', 'tv 0', 'movie 1', 'tv 1']);
    expect(pages[4].items.at(-1)?.title).toBe('movie 64');
  });

  it('merges date-sorted prefixes without moving date ties across page boundaries', async () => {
    const pages = await Promise.all([0, 24, 48].map((offset) => browse({ sort: 'year', limit: 24, offset })));
    const whole = await browse({ sort: 'year', limit: 72 });
    expect(pages.flatMap((p) => ids(p.items))).toEqual(ids(whole.items));
    const dates = whole.items.map((i) => i.date!);
    expect(dates).toEqual([...dates].sort().reverse());
    expect(state.discover).toHaveBeenCalledWith('movie', expect.objectContaining({ sortBy: 'primary_release_date.desc' }));
    expect(state.discover).toHaveBeenCalledWith('tv', expect.objectContaining({ sortBy: 'first_air_date.desc' }));
    expect(SORTS).not.toContain('title');
  });

  it('fetches both kinds for all-type genres and honours year sort on genres', async () => {
    const result = await browse({ genre: 'Action', sort: 'year', limit: 24 });
    expect(new Set(result.items.map((i) => i.kind))).toEqual(new Set(['movie', 'show']));
    expect(state.discover).toHaveBeenCalledWith('movie', expect.objectContaining({ withGenres: '28', sortBy: 'primary_release_date.desc' }));
    expect(state.discover).toHaveBeenCalledWith('tv', expect.objectContaining({ withGenres: '10759', sortBy: 'first_air_date.desc' }));
  });

  it('uses exact search totals and includes partial last upstream pages', async () => {
    const a = await browse({ q: 'query', limit: 24 });
    const b = await browse({ q: 'query', limit: 24, offset: 24 });
    expect(a.total).toBe(30);
    expect(b.items).toHaveLength(6);
    expect(new Set(ids([...a.items, ...b.items])).size).toBe(30);
    expect(normalizeBrowse({ q: 'query', sort: 'year' }).sort).toBe('newest');
  });

  it('keeps local-source prefixes stable and excludes their duplicates on later pages', async () => {
    const [local] = await state.db.insert(schema.movies).values({ tmdbId: 1025, title: 'Local cached title', isPublished: true }).returning();
    await state.db.insert(schema.sources).values({ movieId: local.id, label: '720p', kind: 'direct', url: 'https://example.invalid/movie' });
    const pages = await Promise.all([0, 24, 48, 72, 96].map((offset) => browse({ type: 'movie', limit: 24, offset })));
    const actual = pages.flatMap((p) => ids(p.items));
    expect(actual[0]).toBe(`movie:${local.id}`);
    expect(actual).toHaveLength(65);
    expect(new Set(actual).size).toBe(65);
    expect(actual).not.toContain('movie:tmdb-1025');
  });

  it('falls back to published playable local titles when remote requests reject', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const [local] = await state.db.insert(schema.movies).values({ tmdbId: 1025, title: 'Published local', isPublished: true }).returning();
      await state.db.insert(schema.sources).values({ movieId: local.id, label: '720p', kind: 'direct', url: 'https://example.invalid/movie' });
      await state.db.insert(schema.movies).values({ tmdbId: 1026, title: 'Unpublished local', isPublished: false });
      state.discover.mockRejectedValue(new Error('TMDB unavailable'));
      const result = await browse({ type: 'movie', sort: 'year', withTotal: true });
      expect(result.items.map((i) => i.title)).toEqual(['Published local']);
      expect(result.total).toBe(1);
    } finally {
      log.mockRestore();
    }
  });

  it('returns featured backdrops without fetching logos', async () => {
    expect(await listFeatured()).toHaveLength(10);
    expect(state.logo).not.toHaveBeenCalled();
  });
});
