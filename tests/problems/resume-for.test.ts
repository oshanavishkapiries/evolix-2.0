import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle> }));
vi.mock('@/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === 'function' ? value.bind(state.db) : value; } }) }));

import { COMPLETE_RATIO, continueWatching, resumeFor } from '@/lib/viewer/library';

let pg: PGlite;
let tmdbId = 0;
const userId = randomUUID();

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  }
  state.db = drizzle(pg);
  await state.db.insert(schema.users).values({ id: userId, email: 'resume@test.invalid', passwordHash: 'unused' });
}, 30000);
afterAll(async () => { await pg?.close(); });

async function movie(completed = false, position = 120) {
  const [row] = await state.db.insert(schema.movies).values({ tmdbId: ++tmdbId, title: 'Movie', isPublished: true }).returning();
  await state.db.insert(schema.watchProgress).values({ userId, movieId: row.id, completed, positionSeconds: position, durationSeconds: 1200 });
  return row;
}

async function show(count = 3) {
  const [row] = await state.db.insert(schema.shows).values({ tmdbId: ++tmdbId, name: 'Show', isPublished: true, backdropPath: '/show.jpg' }).returning();
  const [season] = await state.db.insert(schema.seasons).values({ showId: row.id, seasonNumber: 1 }).returning();
  const eps = await state.db.insert(schema.episodes).values(Array.from({ length: count }, (_, i) => ({ seasonId: season.id, episodeNumber: i + 1, name: `Episode ${i + 1}`, stillPath: `/episode-${i + 1}.jpg` }))).returning();
  return { ...row, season, eps };
}

async function progress(episodeId: string, values: Partial<typeof schema.watchProgress.$inferInsert> = {}) {
  await state.db.insert(schema.watchProgress).values({ userId, episodeId, positionSeconds: 120, durationSeconds: 1200, ...values });
}

async function expectHomeMatch(kind: 'movie' | 'show', id: string) {
  const home = (await continueWatching(userId, 200)).find((item) => item.target.kind === kind && item.target.id === id) ?? null;
  expect(await resumeFor(userId, kind, id)).toEqual(home);
}

describe('targeted title resume against Postgres', () => {
  it('returns a movie in progress with the existing display fields', async () => {
    const row = await movie();
    expect(await resumeFor(userId, 'movie', row.id)).toMatchObject({ href: `/watch/movie/${row.id}`, percent: 10, leftMinutes: 18 });
    await expectHomeMatch('movie', row.id);
    expect(await resumeFor(randomUUID(), 'movie', row.id)).toBeNull();
  });

  it('omits a finished movie and a movie below the resume threshold', async () => {
    const finished = await movie(true, 1200 * COMPLETE_RATIO);
    const barely = await movie(false, 9);
    expect(await resumeFor(userId, 'movie', finished.id)).toBeNull();
    expect(await resumeFor(userId, 'movie', barely.id)).toBeNull();
    await expectHomeMatch('movie', finished.id);
  });

  it('resumes the latest episode mid-playback', async () => {
    const row = await show();
    await progress(row.eps[0].id, { updatedAt: new Date('2020-01-01') });
    await progress(row.eps[1].id, { positionSeconds: 600, updatedAt: new Date('2020-01-02') });
    expect(await resumeFor(userId, 'show', row.id)).toMatchObject({ href: `/watch/tv/${row.id}/1/2`, label: 'S1:E2 - Episode 2', backdropPath: '/episode-2.jpg', percent: 50, leftMinutes: 10 });
    await expectHomeMatch('show', row.id);
  });

  it('advances at the stored completion threshold to the next visible, aired episode', async () => {
    const row = await show(1);
    const [season] = await state.db.insert(schema.seasons).values({ showId: row.id, seasonNumber: 2 }).returning();
    await state.db.insert(schema.episodes).values([
      { seasonId: season.id, episodeNumber: 1, isVisible: false },
      { seasonId: season.id, episodeNumber: 2, airDate: '2099-01-01' },
      { seasonId: season.id, episodeNumber: 3, name: 'Next' },
    ]);
    await progress(row.eps[0].id, { completed: true, positionSeconds: 1200 * COMPLETE_RATIO });
    expect(await resumeFor(userId, 'show', row.id)).toMatchObject({ href: `/watch/tv/${row.id}/2/3`, percent: 0, leftMinutes: null, backdropPath: '/show.jpg' });
    await expectHomeMatch('show', row.id);
  });

  it('does not recompute completion from the duration ratio', async () => {
    const row = await show();
    await progress(row.eps[0].id, { positionSeconds: 1140, completed: false });
    expect(await resumeFor(userId, 'show', row.id)).toMatchObject({ href: `/watch/tv/${row.id}/1/1`, percent: 95 });
    await expectHomeMatch('show', row.id);
  });

  it('omits an exhausted show and does not fall back after a barely started latest episode', async () => {
    const exhausted = await show(1);
    await progress(exhausted.eps[0].id, { completed: true });
    expect(await resumeFor(userId, 'show', exhausted.id)).toBeNull();
    const barely = await show();
    await progress(barely.eps[0].id, { updatedAt: new Date('2020-01-01') });
    await progress(barely.eps[1].id, { positionSeconds: 9, updatedAt: new Date('2020-01-02') });
    expect(await resumeFor(userId, 'show', barely.id)).toBeNull();
    await expectHomeMatch('show', barely.id);
  });

  it('finds a show outside the latest 100 episode progress rows', async () => {
    const old = await show();
    await progress(old.eps[0].id, { updatedAt: new Date('2000-01-01') });
    const recent = await show(101);
    await state.db.insert(schema.watchProgress).values(recent.eps.map((ep) => ({ userId, episodeId: ep.id, positionSeconds: 120, durationSeconds: 1200, updatedAt: new Date('2025-01-01') })));
    expect((await continueWatching(userId, 200)).some((item) => item.target.id === old.id)).toBe(false);
    expect(await resumeFor(userId, 'show', old.id)).toMatchObject({ href: `/watch/tv/${old.id}/1/1`, percent: 10 });
  });

  it('rejects non-catalog ids without querying UUID columns', async () => {
    expect(await resumeFor(userId, 'movie', 'tmdb-1')).toBeNull();
    expect(await resumeFor(userId, 'show', 'invalid')).toBeNull();
  });
});
