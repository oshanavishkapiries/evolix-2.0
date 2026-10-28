import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const state = vi.hoisted(() => ({ viewer: 'viewer-0', outcome: null as unknown, engine: null as unknown, capture: vi.fn() }));
vi.mock('@/lib/env', () => ({ env: { JWT_ACCESS_SECRET: 'problems-tests-only-secret-0000000000000000000000' } }));
vi.mock('@/lib/evo/guard', async (original) => ({ ...(await original<typeof import('@/lib/evo/guard')>()), viewerId: async () => state.viewer }));
vi.mock('@/lib/viewer/access', () => ({ canWatch: async () => true }));
vi.mock('@/lib/tmdb', () => ({ TmdbError: class extends Error {} }));
vi.mock('@/lib/evo/promote', () => ({ QUALITIES: ['1080p', '720p', '480p', '360p'], promote: vi.fn(), promotionFromTask: () => null }));
vi.mock('@/lib/evo/ingest', () => ({ startIngest: async () => state.outcome }));
vi.mock('@/lib/errors/capture', () => ({ captureException: state.capture }));
vi.mock('@/lib/evo/client', () => ({ engineFetch: async () => state.engine, EngineUnavailableError: class extends Error {} }));
vi.mock('@/lib/evo/scheduler', () => ({ engineForTask: async () => ({ id: 'e1', url: 'http://engine.invalid', name: 'e1' }), EngineGoneError: class extends Error {}, recordSubtitleOwners: async () => {} }));

import { busyDelay, classifyFailure, MAX_BUSY_RETRIES, parseRetryAfter, problemBody, PROBLEMS } from '@/lib/evo/problems';
import { problemFromBody, problemText } from '@/lib/client/problem';
import { POST as ingest } from '@/app/api/evo/ingest/route';
import { GET as status } from '@/app/api/evo/status/[taskId]/route';

const busy = { kind: 'error', status: 503, body: problemBody('BUSY', { detail: 'Evo engine returned 503', retryAfter: 30 }) };
const post = () => ingest(new NextRequest('http://localhost/api/evo/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tmdbId: 7 }) }));

describe('classifying engine failures', () => {
  it.each([
    ['No streams found for media', 'NO_SOURCE'],
    ['All stream extractors failed for TMDB 5: a; b', 'NO_SOURCE'],
    ['No provider is available right now: x', 'NO_SOURCE'],
    ['playlist refused (HTTP 403) for 720p', 'NO_SOURCE'],
    ['Engine is busy, try again shortly', 'BUSY'],
    ['English subtitle could not be read: HTTP 429', 'SUBTITLES'],
    ['OpenRouter HTTP 402', 'SUBTITLES'],
    ['The Evo engine did not answer', 'ENGINE_UNAVAILABLE'],
    ['Traceback: KeyError foo', 'UNKNOWN'],
    ['', 'UNKNOWN'],
  ])('%s -> %s', (text, code) => expect(classifyFailure(text)).toBe(code));

  it('never lets an engine text into the friendly wording', () => {
    for (const p of Object.values(PROBLEMS)) expect(`${p.title} ${p.message}`).not.toMatch(/HTTP|\d{3}|engine|extractor|provider|traceback/i);
  });
});

describe('retry timing', () => {
  it('grows with each try, stays within sane bounds and is jittered', () => {
    const at = (attempt: number, r: number) => busyDelay(20, attempt, () => r);
    expect(at(0, 0.5)).toBe(20);
    expect(at(3, 0.5)).toBeGreaterThan(at(0, 0.5));
    expect(at(0, 0)).toBeLessThan(at(0, 1));
    for (let a = 0; a < 20; a++) expect(busyDelay(500, a, () => 1)).toBeLessThanOrEqual(75);
    expect(busyDelay(1, 0, () => 0)).toBeGreaterThanOrEqual(4);
    expect(MAX_BUSY_RETRIES).toBeGreaterThan(0);
  });
  it('reads and clamps Retry-After', () => {
    expect(parseRetryAfter('30')).toBe(30);
    expect(parseRetryAfter('9999')).toBe(120);
    expect(parseRetryAfter('1')).toBe(5);
    expect(parseRetryAfter('soon')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('what the browser makes of an answer', () => {
  it('uses the friendly text for known codes and plain server messages otherwise', () => {
    expect(problemFromBody({ code: 'NO_SOURCE', message: 'x' }).title).toBe(PROBLEMS.NO_SOURCE.title);
    expect(problemFromBody({ code: 'ACCOUNT_PENDING', message: 'Your account is waiting for admin approval' }, 403).message).toBe('Your account is waiting for admin approval');
    expect(problemFromBody({}, 429).code).toBe('RATE_LIMITED');
    expect(problemFromBody(null, 500).code).toBe('UNKNOWN');
  });
  it('does not promise automatic retries where there are none', () => {
    const p = problemFromBody({ code: 'BUSY' });
    expect(problemText(p, true)).toMatch(/keep trying/);
    expect(problemText(p, false)).not.toMatch(/keep trying/);
  });
});

describe('ingest route', () => {
  let n = 0;
  beforeEach(() => { state.capture.mockClear(); state.viewer = `viewer-${++n}`; }); // the allowance is per viewer

  it('answers busy with a Retry-After and no engine text, and never uses up the viewer allowance', async () => {
    state.outcome = busy;
    for (let i = 0; i < 30; i++) {
      const res = await post();
      expect(res.status, `try ${i}`).toBe(503);
      expect(res.headers.get('Retry-After')).toBe('30');
      const body = await res.json();
      expect(body).toMatchObject({ code: 'BUSY', retryAfter: 30 });
      expect(JSON.stringify(body)).not.toMatch(/engine returned|detail/i);
    }
  });

  it('still limits a viewer whose requests really start tasks', async () => {
    state.outcome = { kind: 'started', data: { task_id: 't', status: 'PENDING' }, engineId: 'e1' };
    const codes: number[] = [];
    for (let i = 0; i < 14; i++) codes.push((await post()).status);
    expect(codes.slice(0, 12).every((c) => c === 200)).toBe(true);
    expect(codes.slice(12)).toEqual([429, 429]);
    const limited = await (await post()).json();
    expect(limited).toMatchObject({ code: 'RATE_LIMITED', title: PROBLEMS.RATE_LIMITED.title });
  });

  it('reports an unknown failure with a reference, and keeps the raw text out of the answer', async () => {
    state.outcome = { kind: 'error', status: 502, body: problemBody('UNKNOWN', { detail: 'Traceback: KeyError secret_provider_name' }) };
    const res = await ingest(new NextRequest('http://localhost/api/evo/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ tmdbId: 8 }) }));
    const body = await res.json();
    expect(body.code).toBe('UNKNOWN');
    expect(body.ref).toMatch(/^[A-Z0-9]{4,6}$/);
    expect(JSON.stringify(body)).not.toMatch(/Traceback|secret_provider_name/);
    expect(state.capture).toHaveBeenCalledOnce();
    expect(String((state.capture.mock.calls[0][0] as Error).message)).toContain('KeyError');
    expect(state.capture.mock.calls[0][1].tags.ref).toBe(body.ref);
  });
});

describe('status route', () => {
  const ask = () => status(new NextRequest('http://localhost/api/evo/status/11111111-1111-4111-8111-111111111111'), { params: Promise.resolve({ taskId: '11111111-1111-4111-8111-111111111111' }) });

  it('turns a failed task into a plain sentence and a code', async () => {
    state.engine = Response.json({ task_id: 't', status: 'FAILED', message: 'All stream extractors failed for TMDB 9: vidsrc: HTTP 403; cinesrc: timeout', progress_pct: 0 });
    const body = await (await ask()).json();
    expect(body).toMatchObject({ status: 'FAILED', code: 'NO_SOURCE', message: PROBLEMS.NO_SOURCE.message });
    expect(JSON.stringify(body)).not.toMatch(/vidsrc|cinesrc|HTTP 403/);
  });

  it('leaves progress messages of a running task alone', async () => {
    state.engine = Response.json({ task_id: 't', status: 'EXTRACTING', message: 'Decrypting stream sources...', progress_pct: 20 });
    expect((await (await ask()).json()).message).toBe('Decrypting stream sources...');
  });

  it('says the service is restarting when the engine answers 502', async () => {
    state.engine = new Response('bad gateway', { status: 502 });
    const res = await ask();
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('ENGINE_UNAVAILABLE');
  });
});
