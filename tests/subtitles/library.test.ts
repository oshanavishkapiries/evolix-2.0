import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import * as schema from '@/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown as PgliteDatabase<typeof schema>, user: '' as string | null, movie: '', engineFetch: vi.fn(), engine: { id: 'local-test', name: 'test', url: 'http://127.0.0.1:9999' }, revalidate: vi.fn() }));
vi.mock('@/db', () => ({ get db() { return state.db; } }));
vi.mock('@/lib/env', () => ({ env: { JWT_ACCESS_SECRET: 'subtitle-tests-only-secret-0000000000000000000000' } }));
vi.mock('next/cache', () => ({ revalidateTag: state.revalidate }));
vi.mock('@/lib/auth/session', () => ({ authenticate: vi.fn(async () => state.user ? { userId: state.user, sessionId: 'test' } : null) }));
vi.mock('@/lib/viewer/access', () => ({ canWatch: vi.fn(async () => true) }));
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: vi.fn(async () => ({ id: state.user, email: 'admin@example.invalid' })) }));
vi.mock('@/lib/evo/ensure', () => ({ ensureMovie: vi.fn(async () => state.movie), ensureEpisode: vi.fn(async () => null) }));
vi.mock('@/lib/evo/context', () => ({ titleContext: vi.fn(async () => ({ imdbId: 'tt1234567', title: 'Test', synopsis: '', characters: [], runtimeMinutes: 100 })) }));
vi.mock('@/lib/evo/client', () => ({ engineFetch: state.engineFetch, engineById: () => state.engine, defaultEngine: () => state.engine, EngineUnavailableError: class extends Error {} }));
vi.mock('@/lib/evo/scheduler', () => ({ claimEngine: vi.fn(async () => state.engine), claimedEngine: vi.fn(async () => state.engine), recordTask: vi.fn(), recordSubtitleOwners: vi.fn(), sinhalaKey: (...p: unknown[]) => p.join(':') }));
vi.mock('@/lib/errors/capture', () => ({ captureException: vi.fn() }));

import { accessibleTrack, listTracks, recordActivity, reserveQuota, saveTrack } from '@/lib/subtitles/store';
import { signCandidate } from '@/lib/subtitles/candidates';
import { promote } from '@/lib/evo/promote';
import { GET as list } from '@/app/api/subtitles/route';
import { POST as select } from '@/app/api/subtitles/select/route';
import { GET as search } from '@/app/api/subtitles/search/route';
import { POST as translate } from '@/app/api/evo/translate/route';
import { POST as upload } from '@/app/api/subtitles/upload/route';
import { POST as automatic } from '@/app/api/subtitles/auto/route';
import { POST as share } from '@/app/api/subtitles/share/route';
import { DELETE as remove, PATCH as patch } from '@/app/api/admin/subtitles/[id]/route';

let pg: PGlite;
let users: string[];
let legacy: Record<string, unknown>;
const request = (path: string, body?: unknown, method = 'POST') => new NextRequest(`http://localhost${path}`, body === undefined ? { method: 'GET' } : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const track = (extras: Partial<typeof schema.subtitles.$inferInsert> = {}) => saveTrack({ movieId: state.movie }, { language: 'en', label: 'English', url: 'https://pixeldrain.com/api/file/testFile', format: 'vtt', ...extras });

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) {
    if (file.startsWith('0016')) {
      const movieId = randomUUID();
      await pg.query('insert into movies (id, tmdb_id, title) values ($1, 999, $2)', [movieId, 'Legacy']);
      await pg.query('insert into subtitles (movie_id, language, label, url, format) values ($1, $2, $3, $4, $5)', [movieId, 'en', 'English', 'https://pixeldrain.com/api/file/legacy', 'vtt']);
    }
    await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  }
  legacy = (await pg.query<Record<string, unknown>>('select source, visibility, score, plays_ok, reports from subtitles')).rows[0];
  state.db = drizzle(pg, { schema });
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE users, movies, shows, subtitle_quota CASCADE');
  users = Array.from({ length: 5 }, randomUUID);
  for (const [i, id] of users.entries()) await state.db.insert(schema.users).values({ id, email: `user${i}@test.invalid`, passwordHash: 'unused' });
  state.user = users[0]; state.movie = randomUUID();
  await state.db.insert(schema.movies).values({ id: state.movie, tmdbId: 42, title: 'Test' });
  state.engineFetch.mockReset();
});

describe('library storage and ranking', () => {
  it('backfills existing rows while migrating the complete prior schema', () => {
    expect(legacy).toEqual({ source: 'auto', visibility: 'shared', score: 0, plays_ok: 0, reports: 0 });
  });
  it('keeps different origins and upserts null origins idempotently', async () => {
    const first = await track();
    expect((await track({ label: 'Updated' })).id).toBe(first.id);
    await track({ source: 'opensubtitles', originRef: 'file1' });
    await track({ source: 'opensubtitles', originRef: 'file2' });
    expect(await listTracks({ movieId: state.movie }, users[0])).toHaveLength(3);
  });
  it('ranks score before recency and excludes hidden and other private tracks', async () => {
    const best = await track({ originRef: 'best', score: 10, lastUsedAt: new Date(0) });
    await track({ originRef: 'recent', score: 1, lastUsedAt: new Date() });
    const own = await track({ source: 'upload', originRef: 'private', visibility: 'private', uploadedBy: users[0] });
    await track({ originRef: 'hidden', score: 100, hidden: true });
    expect((await listTracks({ movieId: state.movie }, users[1])).map((t) => t.id)).toEqual([best.id, expect.any(String)]);
    expect(await accessibleTrack(own.id, users[1])).toBeNull();
    expect(await accessibleTrack(own.id, users[0])).not.toBeNull();
  });
  it('requires 60 seconds and counts each successful viewing session once', async () => {
    const t = await track();
    const playId = await recordActivity(users[1], t.id, 'start') as string;
    await recordActivity(users[1], t.id, 'played', undefined, playId);
    expect((await accessibleTrack(t.id, users[0]))?.playsOk).toBe(0);
    await pg.query("update subtitle_plays set started_at = now() - interval '61 seconds'");
    await recordActivity(users[1], t.id, 'played', undefined, playId); await recordActivity(users[1], t.id, 'played', undefined, playId);
    expect((await accessibleTrack(t.id, users[0]))?.playsOk).toBe(1);
    // The same viewer cannot score the same track again on the same day.
    const second = await recordActivity(users[1], t.id, 'start') as string;
    await pg.query("update subtitle_plays set started_at = now() - interval '61 seconds' where id = $1", [second]);
    expect(await recordActivity(users[1], t.id, 'played', undefined, second)).toBe(false);
    expect((await accessibleTrack(t.id, users[0]))?.playsOk).toBe(1);
    // A different viewer scores, and so does the same viewer on a later day.
    const other = await recordActivity(users[2], t.id, 'start') as string;
    await pg.query("update subtitle_plays set started_at = now() - interval '61 seconds' where id = $1", [other]);
    await recordActivity(users[2], t.id, 'played', undefined, other);
    await pg.query("update subtitle_plays set completed_at = now() - interval '2 days' where id = $1", [playId]);
    await recordActivity(users[1], t.id, 'played', undefined, second);
    expect((await accessibleTrack(t.id, users[0]))?.playsOk).toBe(3);
  });
  it('promotes after three invited other viewers and shares dependent translations', async () => {
    const source = await track({ source: 'upload', originRef: 'private', visibility: 'private', uploadedBy: users[0] });
    const si = await track({ language: 'si', source: 'translation', originRef: source.id, originTrackId: source.id, visibility: 'private', uploadedBy: users[0] });
    for (const userId of users.slice(1, 4)) {
      await state.db.insert(schema.subtitleGrants).values({ trackId: source.id, userId });
      expect(await accessibleTrack(si.id, userId)).not.toBeNull();
      const playId = await recordActivity(userId, source.id, 'start') as string;
      await pg.query("update subtitle_plays set started_at = now() - interval '61 seconds'");
      await recordActivity(userId, source.id, 'played', undefined, playId);
    }
    expect((await accessibleTrack(source.id, users[4]))?.visibility).toBe('shared');
    expect((await accessibleTrack(si.id, users[4]))?.visibility).toBe('shared');
  });
  it('deduplicates votes and reports, hides on third distinct report, and allows admin restore', async () => {
    const t = await track();
    await recordActivity(users[0], t.id, 'good'); await recordActivity(users[0], t.id, 'good');
    await recordActivity(users[1], t.id, 'report', 'wrong_movie'); await recordActivity(users[1], t.id, 'report', 'wrong_movie');
    expect(await recordActivity(users[2], t.id, 'report', 'out_of_sync')).toBe(false);
    expect((await accessibleTrack(t.id, users[0]))?.score).toBe(-5);
    expect(await recordActivity(users[3], t.id, 'report', 'wrong_language')).toBe(true);
    expect(await accessibleTrack(t.id, users[0])).toBeNull();
    const res = await patch(request('/api/admin/subtitles/x', { hidden: false }, 'PATCH'), { params: Promise.resolve({ id: t.id }) });
    expect(res.status).toBe(200);
    expect((await accessibleTrack(t.id, users[0]))?.score).toBe(-8);
  });
  it('reserves upload and translation quotas atomically', async () => {
    expect(await Promise.all(Array.from({ length: 5 }, () => reserveQuota(users[0], 'title', 'translation', 3)))).toEqual([true, true, true, false, false]);
    for (let i = 0; i < 10; i++) expect(await reserveQuota(users[0], 'all', 'upload', 10)).toBe(true);
    expect(await reserveQuota(users[0], 'all', 'upload', 10)).toBe(false);
  });
  it('uses last successful use only to break equal scores', async () => {
    const old = await track({ originRef: 'old', score: 4, lastUsedAt: new Date(0) });
    const recent = await track({ originRef: 'recent', score: 4, lastUsedAt: new Date() });
    expect((await listTracks({ movieId: state.movie }, users[0])).map((t) => t.id)).toEqual([recent.id, old.id]);
  });
  it('does not promote an uploaded track with a report', async () => {
    const source = await track({ source: 'upload', originRef: 'private', visibility: 'private', uploadedBy: users[0] });
    await recordActivity(users[0], source.id, 'report', 'out_of_sync');
    for (const user of users.slice(1, 4)) {
      const playId = await recordActivity(user, source.id, 'start') as string;
      await pg.query("update subtitle_plays set started_at = now() - interval '61 seconds'");
      await recordActivity(user, source.id, 'played', undefined, playId);
    }
    expect((await accessibleTrack(source.id, users[0]))?.visibility).toBe('private');
  });
});

describe('authenticated API and engine integration', () => {
  it('skips a reported provider file instead of republishing it through automatic selection', async () => {
    await track({ source: 'opensubtitles', originRef: '1', hidden: true, reports: 3 });
    state.engineFetch.mockImplementation(async (path: string, options?: { body?: { ref?: string } }) => path.includes('/search')
      ? Response.json([{ ref: 'sub_1234567_en_1' }, { ref: 'sub_1234567_en_2' }])
      : Response.json({ id: options?.body?.ref, originRef: options?.body?.ref?.endsWith('_1') ? '1' : '2', url: 'https://pixeldrain.com/api/file/provider' }));
    const res = await automatic(request('/api/subtitles/auto', { tmdbId: 42 }));
    const body = (await res.json()).track;
    expect(body).toMatchObject({ source: 'auto', visibility: 'shared' });
    expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['uploadedBy', 'engineId', 'originRef']));
    const [stored] = await state.db.select().from(schema.subtitles).where(eq(schema.subtitles.id, body.id));
    expect(stored).toMatchObject({ originRef: '2', hidden: false });
    expect(await listTracks({ movieId: state.movie }, users[0])).toHaveLength(1);
  });
  it('stores an upload privately and rejects oversized multipart bodies without trusting Content-Length', async () => {
    const form = new FormData(); form.set('tmdbId', '42'); form.set('language', 'en');
    form.set('file', new File(['valid subtitle is checked by the fake engine'], 'own.srt'));
    state.engineFetch.mockResolvedValue(Response.json({ id: 'upload_hash', originRef: 'upload_hash', url: 'https://pixeldrain.com/api/file/uploaded' }));
    const res = await upload(new NextRequest('http://localhost/api/subtitles/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(201);
    const uploaded = (await res.json()).track;
    expect(uploaded).toMatchObject({ visibility: 'private', source: 'upload', canShare: true });
    expect(uploaded.uploadedBy).toBeUndefined();
    const [stored] = await state.db.select().from(schema.subtitles).where(eq(schema.subtitles.id, uploaded.id));
    expect(stored.uploadedBy).toBe(users[0]);
    expect(await listTracks({ movieId: state.movie }, users[1])).toHaveLength(0);
    const huge = new FormData(); huge.set('file', new File([new Uint8Array(2 * 1024 * 1024 + 20_000)], 'huge.srt'));
    const encoded = new Request('http://localhost/api/subtitles/upload', { method: 'POST', body: huge });
    expect((await upload(new NextRequest(encoded.url, { method: 'POST', headers: encoded.headers, body: await encoded.arrayBuffer() }))).status).toBe(413);
  });
  it('grants private source and translation access only after redeeming an owner invitation', async () => {
    const source = await track({ source: 'upload', visibility: 'private', uploadedBy: users[0], originRef: 'invite' });
    const child = await track({ language: 'si', source: 'translation', originTrackId: source.id, originRef: source.id, visibility: 'private', uploadedBy: users[0] });
    const issued = await share(request('/api/subtitles/share', { trackId: source.id }));
    const { invite } = await issued.json();
    state.user = users[1];
    expect(await accessibleTrack(source.id, users[1])).toBeNull();
    expect((await share(request('/api/subtitles/share', { invite }))).status).toBe(200);
    expect(await accessibleTrack(source.id, users[1])).not.toBeNull();
    expect(await accessibleTrack(child.id, users[1])).not.toBeNull();
    expect(await accessibleTrack(source.id, users[2])).toBeNull();
    expect((await share(request('/api/subtitles/share', { trackId: source.id }))).status).toBe(404);
  });
  it('requires authentication', async () => {
    state.user = null;
    expect((await list(request(`/api/subtitles?movieId=${state.movie}`))).status).toBe(401);
  });
  it('returns only visible tracks and limits searches', async () => {
    await track(); await track({ originRef: 'private', visibility: 'private', uploadedBy: users[1] });
    expect((await (await list(request(`/api/subtitles?movieId=${state.movie}`))).json()).tracks).toHaveLength(1);
    state.engineFetch.mockImplementation(async () => Response.json([]));
    for (let i = 0; i < 10; i++) expect((await search(request('/api/subtitles/search?tmdbId=42&lang=en'))).status).toBe(200);
    expect((await search(request('/api/subtitles/search?tmdbId=42&lang=en'))).status).toBe(429);
  });
  it('binds search choices to the viewer and stores the selected track on its owning engine', async () => {
    const ref = await signCandidate({ target: { tmdbId: 42, mediaType: 'movie' }, engineId: state.engine.id, providerRef: 'sub_1234567_en_1', lang: 'en', label: 'Release A' }, users[0]);
    state.user = users[1];
    expect((await select(request('/api/subtitles/select', { ref }))).status).toBe(400);
    state.user = users[0];
    state.engineFetch.mockResolvedValue(Response.json({ id: 'sub_1234567_en_1', originRef: 'sub_1234567_en_1', url: 'https://pixeldrain.com/api/file/selected' }));
    const res = await select(request('/api/subtitles/select', { ref }));
    expect(res.status).toBe(200);
    const chosen = (await res.json()).track;
    expect(chosen.engineId).toBeUndefined();
    const [stored] = await state.db.select().from(schema.subtitles).where(eq(schema.subtitles.id, chosen.id));
    expect(stored.engineId).toBe(state.engine.id);
  });
  it('reuses an existing translation without engine calls or quota spend and preserves privacy', async () => {
    const source = await track({ source: 'upload', originRef: 'private', visibility: 'private', uploadedBy: users[0] });
    await promote({ tmdbId: 42, mediaType: 'movie', subtitles: [{ language: 'si', label: 'Sinhala', url: 'https://pixeldrain.com/api/file/sinhala', source: 'translation', originTrackId: source.id }] }, state.engine.id);
    const res = await translate(request('/api/evo/translate', { tmdbId: 42, mediaType: 'movie', sourceTrackId: source.id }));
    expect(res.status).toBe(200); expect((await res.json()).state).toBe('done');
    expect(state.engineFetch).not.toHaveBeenCalled();
    expect(await listTracks({ movieId: state.movie }, users[1])).toHaveLength(0);
    expect((await state.db.select().from(schema.subtitleQuota))).toHaveLength(0);
  });
  it('reuses a Sinhala track made before the library when the automatic English is the source', async () => {
    const auto = await track({ source: 'auto', originRef: '111' });
    const upload = await track({ source: 'upload', originRef: 'mine', uploadedBy: users[0], visibility: 'private' });
    await track({ language: 'si', label: 'Sinhala (AI)', url: 'https://pixeldrain.com/api/file/oldSinhala' });
    const reused = await translate(request('/api/evo/translate', { tmdbId: 42, mediaType: 'movie', sourceTrackId: auto.id }));
    expect((await reused.json()).state).toBe('done');
    expect(state.engineFetch).not.toHaveBeenCalled();
    state.engineFetch.mockResolvedValue(new Response(JSON.stringify({ state: 'running', job_id: 'job-1', created: true }), { status: 200 }));
    await translate(request('/api/evo/translate', { tmdbId: 42, mediaType: 'movie', sourceTrackId: upload.id }));
    expect(state.engineFetch).toHaveBeenCalled();
  });
  it('rejects translations once the per-title daily quota is spent', async () => {
    const source = await track();
    for (let i = 0; i < 3; i++) await reserveQuota(users[0], 'movie:42:0:0', 'translation', 3);
    state.engineFetch.mockResolvedValue(Response.json({ state: 'none' }));
    expect((await translate(request('/api/evo/translate', { tmdbId: 42, sourceTrackId: source.id }))).status).toBe(429);
  });
  it('refunds the reservation when the engine cannot create a translation', async () => {
    const source = await track();
    state.engineFetch.mockResolvedValueOnce(Response.json({ state: 'none' })).mockResolvedValueOnce(Response.json({ state: 'unavailable', message: 'Budget reached', created: false }));
    const res = await translate(request('/api/evo/translate', { tmdbId: 42, sourceTrackId: source.id }));
    expect((await res.json()).state).toBe('unavailable');
    expect((await state.db.select().from(schema.subtitleQuota))[0].used).toBe(0);
  });
  it('deletes the CDN files on their owning engine before removing source and translation rows', async () => {
    const source = await track({ engineId: state.engine.id });
    await track({ language: 'si', source: 'translation', originRef: source.id, originTrackId: source.id, url: 'https://pixeldrain.com/api/file/translated', engineId: state.engine.id });
    state.engineFetch.mockImplementation(async () => Response.json({ deleted: true }));
    expect((await remove(request('/api/admin/subtitles/x', {}, 'DELETE'), { params: Promise.resolve({ id: source.id }) })).status).toBe(200);
    expect(state.engineFetch).toHaveBeenCalledTimes(2);
    expect(state.engineFetch.mock.calls[0][0]).toBe('/cdn/delete');
    expect(await state.db.select().from(schema.subtitles)).toHaveLength(0);
  });
});
