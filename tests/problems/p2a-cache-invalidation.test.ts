import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import * as schema from '@/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle>, revalidate: vi.fn(), tag: vi.fn(), life: vi.fn() }));
vi.mock('@/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === 'function' ? value.bind(state.db) : value; } }) }));
vi.mock('next/cache', () => ({ revalidateTag: state.revalidate, cacheTag: state.tag, cacheLife: state.life }));
import { prepareCatalogInvalidation, invalidateCatalogParent } from '@/lib/cms/catalog-invalidation';
import { titleRouteVisible, invalidateTitleVisibility } from '@/lib/viewer/exists';
import { getSetting, setSetting } from '@/lib/settings';

let pg: PGlite;
let movieId: string;
let showId: string;
let episodeId: string;
let sourceId: string;
beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  state.db = drizzle(pg);
  [movieId, showId, episodeId, sourceId] = Array.from({ length: 4 }, () => randomUUID());
  await state.db.insert(schema.movies).values({ id: movieId, tmdbId: 777, title: 'Movie', isPublished: true });
  await state.db.insert(schema.shows).values({ id: showId, tmdbId: 778, name: 'Show', isPublished: true });
  const [season] = await state.db.insert(schema.seasons).values({ showId, seasonNumber: 1, isVisible: true }).returning();
  await state.db.insert(schema.episodes).values({ id: episodeId, seasonId: season.id, episodeNumber: 1, isVisible: true });
  await state.db.insert(schema.sources).values({ id: sourceId, episodeId, label: '720p', kind: 'direct', url: 'https://example.invalid/video' });
}, 30000);
afterAll(async () => { await pg?.close(); });
beforeEach(() => { vi.clearAllMocks(); });
const request = (path: string, method = 'PATCH', body = {}) => new NextRequest(`http://localhost/api/admin/${path}`, { method, ...(method === 'DELETE' || method === 'GET' ? {} : { body: JSON.stringify(body) }) });

it('leaves users, settings, support, announcements and operational writes alone', async () => {
  for (const path of ['users/' + movieId, 'settings', 'support/' + movieId, 'announcements', 'evo/queue', `movies/${movieId}/provider-import/preview`]) {
    expect(await prepareCatalogInvalidation(request(path))).toBeNull();
  }
  expect(state.revalidate).not.toHaveBeenCalled();
});
it('refreshes title metadata and lists with SWR, and skips failed mutations', async () => {
  const invalidate = await prepareCatalogInvalidation(request(`movies/${movieId}`, 'PATCH', { title: 'Renamed' }));
  await invalidate!(NextResponse.json({}, { status: 404 }));
  expect(state.revalidate).not.toHaveBeenCalled();
  await invalidate!(NextResponse.json({}));
  expect(state.revalidate.mock.calls).toEqual([[`catalog:movie:${movieId}`, 'max'], ['catalog:list', 'max'], ['tmdb:movie:777', 'max']]);
});
it('captures a source parent before deletion and immediately expires only its show', async () => {
  const invalidate = await prepareCatalogInvalidation(request(`sources/${sourceId}`, 'DELETE'));
  await state.db.delete(schema.sources).where(eq(schema.sources.id, sourceId));
  await invalidate!(NextResponse.json({}));
  expect(state.revalidate.mock.calls).toEqual([[`catalog:show:${showId}`, { expire: 0 }]]);
});
it('expires only the affected title for a subtitle parent', async () => {
  await invalidateCatalogParent({ episodeId });
  expect(state.revalidate.mock.calls).toEqual([[`catalog:show:${showId}`, { expire: 0 }]]);
});
it('reuses visibility reads and clears cached positives on unpublish', async () => {
  expect(await titleRouteVisible(`/movie/${movieId}`)).toBe(true);
  const invalidate = await prepareCatalogInvalidation(request(`movies/${movieId}`, 'PATCH', { isPublished: false }));
  await state.db.update(schema.movies).set({ isPublished: false }).where(eq(schema.movies.id, movieId));
  expect(await titleRouteVisible(`/watch/movie/${movieId}`)).toBe(true);
  await invalidate!(NextResponse.json({}));
  expect(await titleRouteVisible(`/movie/${movieId}`)).toBe(false);
  expect(state.revalidate).toHaveBeenCalledWith('catalog:list', { expire: 0 });
  await state.db.update(schema.movies).set({ isPublished: true }).where(eq(schema.movies.id, movieId));
  invalidateTitleVisibility('movie', movieId);
});
it('republish is visible at once: immediate expiry and no cached negative visibility', async () => {
  await state.db.update(schema.movies).set({ isPublished: false }).where(eq(schema.movies.id, movieId));
  expect(await titleRouteVisible(`/movie/${movieId}`)).toBe(false);
  // Simulates another runtime (the proxy) that never sees invalidateTitleVisibility().
  await state.db.update(schema.movies).set({ isPublished: true }).where(eq(schema.movies.id, movieId));
  expect(await titleRouteVisible(`/movie/${movieId}`)).toBe(true);
  const invalidate = await prepareCatalogInvalidation(request(`movies/${movieId}`, 'PATCH', { isPublished: true }));
  await invalidate!(NextResponse.json({}));
  expect(state.revalidate).toHaveBeenCalledWith(`catalog:movie:${movieId}`, { expire: 0 });
  expect(state.revalidate).toHaveBeenCalledWith('catalog:list', { expire: 0 });
});
it('expires visibility decisions after 30 seconds and preserves episode gating', async () => {
  expect(await titleRouteVisible(`/watch/tv/${showId}/1/1`)).toBe(true);
  await state.db.update(schema.episodes).set({ isVisible: false }).where(eq(schema.episodes.id, episodeId));
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 30_001);
  try { expect(await titleRouteVisible(`/watch/tv/${showId}/1/1`)).toBe(false); } finally { clock.mockRestore(); }
  expect(await titleRouteVisible('/movie/invalid')).toBe(false);
  expect(await titleRouteVisible('/unrelated')).toBeNull();
});
it('tags settings by key and immediately expires writes', async () => {
  expect(await getSetting('requireApproval')).toBe(false);
  expect(state.tag).toHaveBeenCalledWith('setting:requireApproval');
  await setSetting('requireApproval', true);
  expect(state.revalidate.mock.calls).toEqual([['setting:requireApproval', { expire: 0 }]]);
  expect(await getSetting('requireApproval')).toBe(true);
});
it('invalidates a newly created catalog title, its lists and TMDB alias', async () => {
  const id = randomUUID();
  const invalidate = await prepareCatalogInvalidation(request('shows', 'POST', { tmdbId: 779 }));
  await invalidate!(NextResponse.json({ id }, { status: 201 }));
  expect(state.revalidate.mock.calls).toEqual([[`catalog:show:${id}`, 'max'], ['catalog:list', 'max'], ['tmdb:tv:779', 'max']]);
});

it('keeps non-title paths from poisoning title and episode visibility decisions', async () => {
  invalidateTitleVisibility('show', showId);
  expect(await titleRouteVisible(`/watch/tv/${showId}`)).toBeNull();
  expect(await titleRouteVisible(`/tv/${showId}`)).toBe(true);
  expect(await titleRouteVisible(`/tv/${showId}/1/1`)).toBeNull();
  expect(await titleRouteVisible(`/watch/tv/${showId}/1/1`)).toBe(false);
});
it('bounds memory by evicting the oldest visibility result', async () => {
  invalidateTitleVisibility('movie', movieId);
  expect(await titleRouteVisible(`/movie/${movieId}`)).toBe(true);
  for (let i = 0; i < 1000; i++) await titleRouteVisible(`/unknown-${i}`);
  await state.db.update(schema.movies).set({ isPublished: false }).where(eq(schema.movies.id, movieId));
  expect(await titleRouteVisible(`/movie/${movieId}`)).toBe(false);
});
