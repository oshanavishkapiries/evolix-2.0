import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { eq } from 'drizzle-orm';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { NextRequest } from 'next/server';
import * as schema from '@/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown as PgliteDatabase<typeof schema>, user: '' as string | null, surveyOn: true }));
vi.mock('server-only', () => ({}));
vi.mock('@/db', () => ({ get db() { return state.db; } }));
vi.mock('@/lib/settings', () => ({ getSetting: vi.fn(async () => state.surveyOn) }));
vi.mock('@/lib/auth/session', () => ({ authenticate: vi.fn(async () => (state.user ? { userId: state.user, sessionId: 'test' } : null)) }));

import { pickQuestion } from '@/lib/viewer/feedback';
import { POST as ask } from '@/app/api/me/ask/route';
import { PATCH as answer } from '@/app/api/me/ask/[id]/route';
import { PUT as prefs } from '@/app/api/me/feedback-prefs/route';

const DAY = 86_400_000;
let pg: PGlite;
let users: string[];
const media = { key: 'movie:1', title: 'Film' };
const always = () => 0;
const never = () => 0.999;
const json = (path: string, body: unknown, method = 'POST') => new NextRequest(`http://localhost${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
/** An earlier ask, `days` ago. */
const past = (user: string, days: number, outcome: 'shown' | 'answered' | 'ignored' = 'answered', key = 'busy_wait') =>
  state.db.insert(schema.feedbackAsks).values({ questionKey: key, userId: user, mediaKey: `old:${randomUUID()}`, outcome, createdAt: new Date(Date.now() - days * DAY) });

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  state.db = drizzle(pg, { schema });
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  await pg.exec("UPDATE feedback_questions SET active = (key in ('experience', 'subtitle_sync')), sample_rate = case key when 'experience' then 35 when 'subtitle_sync' then 50 else 100 end, target = case key when 'experience' then null else 200 end");
  users = Array.from({ length: 3 }, randomUUID);
  for (const [i, id] of users.entries()) await state.db.insert(schema.users).values({ id, email: `u${i}@test.invalid`, passwordHash: 'unused' });
  state.user = users[0];
  state.surveyOn = true;
});

describe('the shared budget', () => {
  it('asks the moment\'s question and records it as shown', async () => {
    const got = await pickQuestion(users[0], 'subtitle_picked', media, { source: 'opensubtitles' }, always);
    expect(got.ask).toMatchObject({ key: 'subtitle_sync', kind: 'thumbs', prompt: 'Is this subtitle in sync?' });
    const [row] = await state.db.select().from(schema.feedbackAsks);
    expect(row).toMatchObject({ outcome: 'shown', mediaKey: 'movie:1', context: { source: 'opensubtitles' } });
  });

  it('asks nothing when player feedback is off or the viewer opted out', async () => {
    state.surveyOn = false;
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'off' });
    state.surveyOn = true;
    await state.db.insert(schema.feedbackPrefs).values({ userId: users[0], optedOut: true });
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'opted_out' });
  });

  it('keeps 3 days between any two questions, the old survey included', async () => {
    await past(users[0], 2);
    expect((await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).ask).toBeNull();
    await state.db.insert(schema.playerFeedback).values({ userId: users[1], mediaKey: 'movie:9', title: 'Old', rating: 4, createdAt: new Date(Date.now() - DAY) });
    expect(await pickQuestion(users[1], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'gap' });
    await past(users[2], 3.5);
    expect((await pickQuestion(users[2], 'subtitle_picked', media, {}, always)).ask).not.toBeNull();
  });

  it('allows at most 2 questions in 7 days', async () => {
    await past(users[0], 3.2);
    await past(users[0], 6.5);
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'weekly' });
  });

  it('backs off for 30 days after 2 ignored in a row, and an answer resets it', async () => {
    await past(users[0], 10, 'ignored');
    await past(users[0], 5, 'ignored');
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'ignored' });
    await past(users[1], 10, 'ignored');
    await past(users[1], 5, 'answered');
    expect((await pickQuestion(users[1], 'subtitle_picked', media, {}, always)).ask).not.toBeNull();
    await past(users[2], 40, 'ignored');
    await past(users[2], 35, 'ignored');
    expect((await pickQuestion(users[2], 'subtitle_picked', media, {}, always)).ask).not.toBeNull();
  });
});

describe('choosing a question', () => {
  it('asks each viewer once, but the experience survey once per title', async () => {
    await past(users[0], 10, 'answered', 'subtitle_sync');
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'none' });
    await past(users[1], 10, 'answered', 'experience');
    await state.db.update(schema.feedbackAsks).set({ mediaKey: 'movie:1' }).where(eq(schema.feedbackAsks.userId, users[1]));
    expect((await pickQuestion(users[1], 'experience', media, {}, always)).ask).toBeNull();
    expect((await pickQuestion(users[1], 'experience', { key: 'movie:2', title: 'Other' }, {}, always)).ask?.key).toBe('experience');
  });

  it('stops at its target, respects its sample, and skips switched-off questions', async () => {
    await state.db.update(schema.feedbackQuestions).set({ target: 1 }).where(eq(schema.feedbackQuestions.key, 'subtitle_sync'));
    await past(users[1], 10, 'answered', 'subtitle_sync');
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).toEqual({ ask: null, reason: 'none' });
    await state.db.update(schema.feedbackQuestions).set({ target: null }).where(eq(schema.feedbackQuestions.key, 'subtitle_sync'));
    expect(await pickQuestion(users[0], 'subtitle_picked', media, {}, never)).toEqual({ ask: null, reason: 'sampled_out' });
    expect(await pickQuestion(users[0], 'busy_waited', media, {}, always)).toEqual({ ask: null, reason: 'none' });
  });

  it('picks the higher priority when two questions share a moment', async () => {
    await state.db.insert(schema.feedbackQuestions).values({ key: 'subtitle_easy', moment: 'subtitle_picked', kind: 'faces', prompt: 'Easy to find?', priority: 50, active: true });
    expect((await pickQuestion(users[0], 'subtitle_picked', media, {}, always)).ask?.key).toBe('subtitle_easy');
  });
});

describe('the API', () => {
  const start = async () => (await (await ask(json('/api/me/ask', { moment: 'subtitle_picked', mediaKey: 'movie:1', title: 'Film' }))).json()).ask as { id: string } | null;
  it('answers, adds reasons, and never lets "ignored" overwrite an answer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const asked = await start();
    expect(asked).not.toBeNull();
    expect((await answer(json(`/api/me/ask/${asked!.id}`, { value: 3 }, 'PATCH'), params(asked!.id))).status).toBe(400);
    expect((await answer(json(`/api/me/ask/${asked!.id}`, { value: 0 }, 'PATCH'), params(asked!.id))).status).toBe(200);
    expect((await answer(json(`/api/me/ask/${asked!.id}`, { reasons: ['Made up'] }, 'PATCH'), params(asked!.id))).status).toBe(400);
    expect((await answer(json(`/api/me/ask/${asked!.id}`, { reasons: ['Out of sync'], comment: ' 2s late ' }, 'PATCH'), params(asked!.id))).status).toBe(200);
    await answer(json(`/api/me/ask/${asked!.id}`, { outcome: 'ignored' }, 'PATCH'), params(asked!.id));
    const [row] = await state.db.select().from(schema.feedbackAsks);
    expect(row).toMatchObject({ outcome: 'answered', value: 0, reasons: ['Out of sync'], comment: '2s late' });
  });

  it('only the viewer who was asked can answer', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const asked = await start();
    state.user = users[1];
    expect((await answer(json(`/api/me/ask/${asked!.id}`, { value: 1 }, 'PATCH'), params(asked!.id))).status).toBe(404);
  });

  it('"don\'t ask me" stops questions until switched back on', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    await prefs(json('/api/me/feedback-prefs', { optedOut: true }, 'PUT'));
    expect(await start()).toBeNull();
    await prefs(json('/api/me/feedback-prefs', { optedOut: false }, 'PUT'));
    expect(await start()).not.toBeNull();
  });
});
