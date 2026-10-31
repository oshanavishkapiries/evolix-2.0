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

import { readThread, sendMessage, markRead, unreadCount, inbox, setStatus, findUsers, deleteOwnMessage, clearHistory, supportNotification, deleteConversation } from '@/lib/support/store';
import { GET as viewerGet, POST as viewerPost, DELETE as viewerClear } from '@/app/api/me/support/route';
import { DELETE as viewerDelete } from '@/app/api/me/support/messages/[id]/route';
import { POST as viewerRead } from '@/app/api/me/support/read/route';
import { GET as adminGet, POST as adminPost, PATCH as adminPatch, DELETE as adminDelete } from '@/app/api/admin/support/[userId]/route';
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

describe('deleting messages and clearing history', () => {
  it('deletes the whole thread and its read state, resets other sessions, and preserves user accounts and unrelated chats', async () => {
    const first = await send('Question');
    await send('Support answer', viewer, admin, true);
    await send('Unrelated question', other, other);
    await markRead(viewer, admin, first.id);
    const prior = await readThread(viewer, false);
    const oldId = prior.conversation!.id;
    expect(await deleteConversation(viewer, oldId)).toBe(true);
    const cleared = await readThread(viewer, false, { after: first.id, version: prior.version });
    expect(cleared).toMatchObject({ conversation: null, reset: true, messages: [] });
    expect((await pg.query('select * from support_read_states')).rows).toHaveLength(0);
    expect((await readThread(other, false)).messages).toHaveLength(1);
    expect((await pg.query('select * from users')).rows).toHaveLength(4);
    const newMessage = await send('A fresh question');
    expect(await deleteConversation(viewer, oldId)).toBe(false); // a stale confirmation cannot delete the new chat
    const fresh = await readThread(viewer, false, { after: first.id, version: prior.version });
    expect(fresh.reset).toBe(true);
    expect(fresh.conversation!.id).not.toBe(oldId);
    expect(fresh.messages.map((m) => m.id)).toEqual([newMessage.id]);
  });

  it('restricts conversation deletion to admins and validates the confirmed thread ID', async () => {
    await send('Question');
    await send('Other question', other, other);
    const thread = await readThread(viewer, true), foreign = await readThread(other, true);
    const request = (conversationId: string) => req('/api/admin/support/' + viewer, { conversationId }, 'DELETE');
    state.admin = '';
    expect((await adminDelete(request(thread.conversation!.id), ctx())).status).toBe(403);
    state.admin = admin;
    expect((await adminDelete(request('invalid'), ctx())).status).toBe(400);
    expect((await adminDelete(request(foreign.conversation!.id), ctx())).status).toBe(404);
    expect((await adminDelete(request(thread.conversation!.id), ctx())).status).toBe(200);
    expect((await readThread(viewer, true)).conversation).toBeNull();
    expect((await readThread(other, true)).messages).toHaveLength(1);
  });

  it('removes only the owner’s outgoing content for both sides and cannot restore it by retrying a send', async () => {
    const clientId = randomUUID();
    const mine = await send('Private original text', viewer, viewer, false, clientId);
    const reply = await send('Support answer', viewer, admin, true);
    const foreign = await send('Another user’s text', other, other);
    expect(await deleteOwnMessage(viewer, reply.id)).toBe(false);
    expect(await deleteOwnMessage(viewer, foreign.id)).toBe(false);
    expect(await deleteOwnMessage(viewer, mine.id)).toBe(true);
    for (const isAdmin of [false, true]) {
      const thread = await readThread(viewer, isAdmin);
      expect(thread.messages[0]).toMatchObject({ id: mine.id, text: 'Message deleted', deletedAt: expect.any(String) });
      expect(JSON.stringify(thread)).not.toContain('Private original text');
    }
    expect(await unreadCount(admin, true)).toBe(1); // only the other user's message remains unread
    expect((await send('Private original text', viewer, viewer, false, clientId)).text).toBe('Message deleted');
  });

  it('invalidates already loaded history in both participants’ other sessions', async () => {
    const mine = await send('Remove me');
    const reply = await send('Answer', viewer, admin, true);
    const beforeUser = await readThread(viewer, false), beforeAdmin = await readThread(viewer, true);
    await deleteOwnMessage(viewer, mine.id);
    for (const [isAdmin, version] of [[false, beforeUser.version], [true, beforeAdmin.version]] as const) {
      const updated = await readThread(viewer, isAdmin, { after: reply.id, version });
      expect(updated.reset).toBe(true);
      expect(updated.messages[0].text).toBe('Message deleted');
    }
  });

  it('clears the user’s view across devices, preserves the admin copy, and delivers future replies', async () => {
    await send('Question');
    const reply = await send('Answer', viewer, admin, true);
    const before = await readThread(viewer, false);
    expect((await supportNotification(viewer)).count).toBe(1);
    await clearHistory(viewer);
    expect((await readThread(viewer, false)).messages).toEqual([]);
    expect((await readThread(viewer, false, { before: reply.id })).messages).toEqual([]);
    expect((await readThread(viewer, false, { after: reply.id, version: before.version })).reset).toBe(true);
    expect((await readThread(viewer, true)).messages).toHaveLength(2);
    expect(await supportNotification(viewer)).toEqual({ count: 0, latest: null });
    const next = await send('A new answer', viewer, admin, true);
    expect((await readThread(viewer, false)).messages.map((m) => m.id)).toEqual([next.id]);
    expect((await supportNotification(viewer)).count).toBe(1);
    expect(await unreadCount(viewer, false)).toBe(1);
  });

  it('requires authentication, validates IDs, and never deletes or clears another user’s chat', async () => {
    const mine = await send('My question'), foreign = await send('Other question', other, other);
    state.viewer = '';
    expect((await viewerDelete(req('/api/me/support/messages/' + mine.id, {}, 'DELETE'), { params: Promise.resolve({ id: String(mine.id) }) })).status).toBe(401);
    expect((await viewerClear(req('/api/me/support', {}, 'DELETE'))).status).toBe(401);
    state.viewer = viewer;
    expect((await viewerDelete(req('/api/me/support/messages/' + foreign.id, {}, 'DELETE'), { params: Promise.resolve({ id: String(foreign.id) }) })).status).toBe(404);
    expect((await viewerDelete(req('/api/me/support/messages/bad', {}, 'DELETE'), { params: Promise.resolve({ id: 'bad' }) })).status).toBe(400);
    expect((await viewerGet(req('/api/me/support?version=bad'))).status).toBe(400);
    expect((await viewerClear(req('/api/me/support', { userId: other }, 'DELETE'))).status).toBe(200);
    expect((await readThread(viewer, false)).messages).toEqual([]);
    expect((await readThread(other, false)).messages[0].text).toBe('Other question');
  });

  it('returns only this user’s unread support reply summary, until explicitly read', async () => {
    await send('First answer', viewer, admin, true);
    const second = await send('Second answer', viewer, secondAdmin, true);
    await send('Unrelated answer', other, admin, true);
    const notification = await supportNotification(viewer);
    expect(notification).toMatchObject({ count: 2, latest: { id: second.id, text: 'Second answer' } });
    expect(JSON.stringify(notification)).not.toContain(admin);
    await readThread(viewer, false); // fetching/opening the bell alone does not mark messages read
    expect((await supportNotification(viewer)).count).toBe(2);
    await markRead(viewer, viewer, second.id);
    expect(await supportNotification(viewer)).toEqual({ count: 0, latest: null });
    expect((await supportNotification(other)).count).toBe(1);
  });
});
