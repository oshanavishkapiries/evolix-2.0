import { randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { NextRequest } from 'next/server';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as schema from '@/db/schema';

const state = vi.hoisted(() => ({ db: null as unknown as ReturnType<typeof drizzle>, viewer: '', admin: '' }));
vi.mock('@/db', () => ({ db: new Proxy({}, { get: (_, key) => { const value = Reflect.get(state.db, key); return typeof value === 'function' ? value.bind(state.db) : value; } }) }));
vi.mock('@/lib/auth/session', () => ({ authenticate: async () => state.viewer ? { userId: state.viewer } : null }));
vi.mock('@/lib/auth/admin', () => ({ requireAdmin: async () => state.admin ? { id: state.admin } : new Response(null, { status: 403 }) }));
vi.mock('@/lib/env', () => ({ env: {} }));

import { readThread, sendMessage, markRead, unreadCount, inbox, setStatus, findUsers } from '@/lib/support/store';
import { GET as viewerGet, POST as viewerPost } from '@/app/api/me/support/route';
import { POST as viewerRead } from '@/app/api/me/support/read/route';
import { GET as adminGet, POST as adminPost, PATCH as adminPatch } from '@/app/api/admin/support/[userId]/route';
import { GET as adminInbox } from '@/app/api/admin/support/route';

let pg: PGlite;
const viewer = randomUUID(), other = randomUUID(), admin = randomUUID(), secondAdmin = randomUUID();
const req = (path: string, body?: unknown, method = 'POST') => new NextRequest(`http://localhost${path}`, body === undefined ? {} : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const ctx = (userId: string = viewer) => ({ params: Promise.resolve({ userId }) });
const send = (text: string, owner = viewer, actor = viewer, isAdmin = false, clientId = randomUUID()) => sendMessage(owner, actor, isAdmin, text, clientId);

beforeAll(async () => {
  pg = new PGlite();
  for (const file of (await readdir('drizzle')).filter((f) => f.endsWith('.sql')).sort()) await pg.exec(await readFile(`drizzle/${file}`, 'utf8'));
  state.db = drizzle(pg);
});
afterAll(async () => { await pg.close(); });
beforeEach(async () => {
  await pg.exec('TRUNCATE users CASCADE');
  for (const [id, email] of [[viewer, 'viewer@test.invalid'], [other, 'other@test.invalid'], [admin, 'admin@test.invalid'], [secondAdmin, 'admin2@test.invalid']]) {
    await state.db.insert(schema.users).values({ id, email, passwordHash: 'unused' });
  }
  state.viewer = viewer; state.admin = admin;
});

describe('support persistence', () => {
  it('does not create a conversation just by opening support', async () => {
    expect(await readThread(viewer, false)).toEqual({ conversation: null, messages: [], hasMore: false });
    expect((await pg.query('select * from support_conversations')).rows).toHaveLength(0);
    expect((await readThread(viewer, true)).recipientEmail).toBe('viewer@test.invalid');
  });

  it('keeps one private thread, allows both sides to initiate, and hides admin identities', async () => {
    await send('Hello from support', viewer, admin, true);
    await send('Thank you');
    const thread = await readThread(viewer, false);
    expect(thread.messages.map((m) => m.senderRole)).toEqual(['admin', 'user']);
    expect(JSON.stringify(thread)).not.toContain(admin);
    expect(thread.conversation).not.toHaveProperty('email');
    expect((await pg.query('select * from support_conversations')).rows).toHaveLength(1);
    expect((await readThread(other, false)).messages).toEqual([]);
  });

  it('deduplicates retries, including concurrent sends with the same request ID', async () => {
    const clientId = randomUUID();
    const messages = await Promise.all([send('Hello', viewer, viewer, false, clientId), send('Hello', viewer, viewer, false, clientId)]);
    expect(messages[0].id).toBe(messages[1].id);
    expect((await readThread(viewer, false)).messages).toHaveLength(1);
    expect((await send('Hello', viewer, viewer, false, clientId)).id).toBe(messages[0].id);
  });

  it('keeps read cursors monotonic and does not mark another thread or future messages read', async () => {
    const first = await send('First');
    const second = await send('Second');
    const foreign = await send('Other thread', other, other);
    expect(await unreadCount(admin, true)).toBe(3);
    await markRead(viewer, admin, foreign.id);
    expect(await unreadCount(admin, true)).toBe(3);
    await markRead(viewer, admin, second.id);
    await markRead(viewer, admin, first.id);
    expect(await unreadCount(admin, true)).toBe(1);
    await send('Arrived later');
    expect(await unreadCount(admin, true)).toBe(2);
    expect(await unreadCount(secondAdmin, true)).toBe(4);
    const reply = await send('Reply', viewer, admin, true);
    expect(await unreadCount(viewer, false)).toBe(1);
    await markRead(viewer, viewer, reply.id);
    expect(await unreadCount(viewer, false)).toBe(0);
  });

  it('separates unread state from needs-reply state and reopens resolved threads only for new messages', async () => {
    const clientId = randomUUID();
    const message = await send('Help', viewer, viewer, false, clientId);
    await markRead(viewer, admin, message.id);
    expect((await inbox(admin, 'needs_reply', '')).conversations).toHaveLength(1);
    await send('Answer', viewer, admin, true);
    expect((await inbox(admin, 'needs_reply', '')).conversations).toHaveLength(0);
    await setStatus(viewer, 'resolved');
    await send('Help', viewer, viewer, false, clientId);
    expect((await inbox(admin, 'resolved', '')).conversations).toHaveLength(1);
    await send('One more question');
    expect((await readThread(viewer, false)).conversation?.status).toBe('open');
  });

  it('paginates message history and incoming messages without gaps', async () => {
    for (let i = 0; i < 57; i++) await send(`Message ${i}`);
    const latest = await readThread(viewer, false);
    expect(latest.messages).toHaveLength(50);
    expect(latest.hasMore).toBe(true);
    expect(latest.messages[0].text).toBe('Message 7');
    const older = await readThread(viewer, false, { before: latest.messages[0].id });
    expect(older.messages.map((m) => m.text)).toEqual(Array.from({ length: 7 }, (_, i) => `Message ${i}`));
    const after = await readThread(viewer, false, { after: older.messages[0].id });
    expect(after.messages).toHaveLength(50);
    expect(after.hasMore).toBe(true);
    expect((await readThread(viewer, false, { after: after.messages.at(-1)!.id })).messages).toHaveLength(6);
  });

  it('escapes wildcard searches and orders the inbox by latest messages', async () => {
    await send('First'); await send('Second', other, other);
    expect((await inbox(admin, 'all', '')).conversations.map((c) => c.userId)).toEqual([other, viewer]);
    expect((await inbox(admin, 'all', 'viewer@')).conversations).toHaveLength(1);
    expect(await findUsers('%')).toEqual([]);
    expect((await findUsers('viewer')).map((u) => u.id)).toEqual([viewer]);
  });
});

describe('authenticated support routes', () => {
  it('rejects guests and non-admin inbox access', async () => {
    state.viewer = ''; state.admin = '';
    expect((await viewerGet(req('/api/me/support'))).status).toBe(401);
    expect((await viewerPost(req('/api/me/support', { text: 'Hi', clientId: randomUUID() }))).status).toBe(401);
    expect((await adminGet(req('/api/admin/support/' + viewer), ctx())).status).toBe(403);
    expect((await adminInbox(req('/api/admin/support'))).status).toBe(403);
    expect((await adminPost(req('/api/admin/support/' + viewer, {}), ctx())).status).toBe(403);
    expect((await adminPatch(req('/api/admin/support/' + viewer, {}, 'PATCH'), ctx())).status).toBe(403);
  });

  it('derives ownership and role from authentication rather than request data; pending users can contact support', async () => {
    const res = await viewerPost(req('/api/me/support', { text: ' Hello ', clientId: randomUUID(), userId: other, senderRole: 'admin' }));
    expect(res.status).toBe(201);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect((await viewerGet(req('/api/me/support'))).headers.get('Cache-Control')).toBe('private, no-store');
    expect((await readThread(viewer, false)).messages[0]).toMatchObject({ text: 'Hello', senderRole: 'user' });
    expect((await readThread(other, false)).messages).toHaveLength(0);
    state.viewer = other;
    expect((await (await viewerGet(req('/api/me/support?userId=' + viewer))).json()).messages).toEqual([]);
    const msg = (await readThread(viewer, false)).messages[0];
    await viewerRead(req('/api/me/support/read', { through: msg.id }));
    expect(await unreadCount(admin, true)).toBe(1);
  });

  it('validates text, UUIDs, and pagination before writing', async () => {
    for (const text of ['', '   ', 'x'.repeat(2001)]) expect((await viewerPost(req('/api/me/support', { text, clientId: randomUUID() }))).status).toBe(400);
    expect((await viewerPost(req('/api/me/support', { text: 'Hello', clientId: 'bad-id' }))).status).toBe(400);
    expect((await viewerGet(req('/api/me/support?before=-1'))).status).toBe(400);
    expect((await viewerGet(req('/api/me/support?before=1&after=2'))).status).toBe(400);
    expect((await adminGet(req('/api/admin/support/nope'), ctx('nope'))).status).toBe(404);
    expect((await adminPost(req('/api/admin/support/' + randomUUID(), { text: 'Hello', clientId: randomUUID() }), ctx(randomUUID()))).status).toBe(404);
    expect((await readThread(viewer, false)).messages).toHaveLength(0);
  });

  it('limits new sends while allowing a retry of an already persisted message', async () => {
    const clientId = randomUUID();
    await send('First', viewer, viewer, false, clientId);
    for (let i = 0; i < 29; i++) await send(`Message ${i}`);
    expect((await viewerPost(req('/api/me/support', { text: 'Too many', clientId: randomUUID() }))).status).toBe(429);
    expect((await viewerPost(req('/api/me/support', { text: 'First', clientId }))).status).toBe(201);
    expect((await readThread(viewer, false)).messages).toHaveLength(30);
  });
});
