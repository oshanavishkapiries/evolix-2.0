import { expect, test, type Route } from '@playwright/test';
import type { SupportMessage } from '@/lib/support/types';
const userId = '11111111-1111-4111-8111-111111111111';
const json = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const msg = (id: number, text: string, senderRole: 'user' | 'admin' = 'admin'): SupportMessage => ({ id, text, senderRole, createdAt: '2026-11-01T10:30:00Z' });

test('mobile has a direct Support tab and failed sends retain the draft and request ID', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const messages = [msg(1, 'Hello! How can we help?')];
  const attempts: string[] = [];
  let first = true;
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/unread')) return json(route, { count: 0 });
    if (url.pathname.endsWith('/read')) return json(route, {});
    if (request.method() === 'POST') {
      const body = request.postDataJSON(); attempts.push(body.clientId);
      if (first) { first = false; messages.push(msg(2, body.text, 'user')); return route.abort(); }
      return json(route, { sent: messages[1] }, 201);
    }
    const after = Number(url.searchParams.get('after') || 0);
    return json(route, { conversation: { id: 'thread', userId, status: 'open' }, messages: messages.filter((m) => m.id > after), hasMore: false });
  });
  await page.goto('/');
  await expect(page.getByText('Hello! How can we help?')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Support' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Your message', exact: true }).fill('Episode 6 is not available.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry send' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue('Episode 6 is not available.');
  await page.getByRole('button', { name: 'Retry send' }).click();
  await expect(page.getByRole('textbox', { name: 'Your message', exact: true })).toHaveValue('');
  await expect(page.getByText('Episode 6 is not available.', { exact: true })).toHaveCount(1);
  expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const chat = await page.locator('.support-chat').boundingBox();
  const nav = await page.getByRole('navigation', { name: 'Main' }).boundingBox();
  expect(chat!.x).toBe(0);
  expect(chat!.width).toBe(390);
  expect(Math.abs(chat!.y + chat!.height - nav!.y)).toBeLessThanOrEqual(1);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await page.screenshot({ path: '/tmp/evolix-support-mobile.png', fullPage: true });
});

test('admins can select a user, start a conversation, and resolve it', async ({ page }) => {
  const messages: SupportMessage[] = [];
  let status = 'open';
  const deleted: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/unread')) return json(route, { count: 0 });
    if (url.pathname.endsWith('/read')) return json(route, {});
    if (url.searchParams.has('directory')) return json(route, { users: [{ id: userId, email: 'viewer@test.invalid' }] });
    if (request.method() === 'DELETE') { deleted.push(request.postDataJSON().conversationId); messages.length = 0; return json(route, {}); }
    if (request.method() === 'POST') { messages.push(msg(1, request.postDataJSON().text)); return json(route, { sent: messages[0] }, 201); }
    if (request.method() === 'PATCH') { status = request.postDataJSON().status; return json(route, {}); }
    if (url.pathname.endsWith(userId)) {
      const after = Number(url.searchParams.get('after') || 0);
      return json(route, { conversation: messages.length ? { id: 'thread', userId, status, email: 'viewer@test.invalid' } : null, recipientEmail: 'viewer@test.invalid', messages: messages.filter((m) => m.id > after), hasMore: false });
    }
    return json(route, { conversations: messages.length ? [{ id: 'thread', userId, status, email: 'viewer@test.invalid', latestText: messages[0].text, latestRole: 'admin', latestId: 1, lastAt: messages[0].createdAt, unread: 0 }] : [], hasMore: false });
  });
  await page.goto('/?admin=1');
  await page.getByRole('button', { name: '+ New conversation' }).click();
  await page.getByLabel('Find a user by email').fill('viewer');
  await page.getByRole('button', { name: 'viewer@test.invalid', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'viewer@test.invalid' })).toBeVisible();
  await page.getByLabel('Reply to user').fill('We fixed the playback issue. Please try again.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('We fixed the playback issue. Please try again.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Resolve', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible();
  const desktopChat = await page.locator('.support-chat').boundingBox();
  expect(Math.abs(desktopChat!.x + desktopChat!.width - 1280)).toBeLessThanOrEqual(1);
  expect(Math.abs(desktopChat!.y + desktopChat!.height - 850)).toBeLessThanOrEqual(1);
  await page.screenshot({ path: '/tmp/evolix-support-admin.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '← Inbox' })).toBeVisible();
  await expect(page.getByLabel('Search conversations')).not.toBeVisible();
  const mobileChat = await page.locator('.support-chat').boundingBox();
  expect(mobileChat!.width).toBe(390);
  expect(Math.abs(mobileChat!.y + mobileChat!.height - 844)).toBeLessThanOrEqual(1);
  await page.getByRole('button', { name: '← Inbox' }).click();
  await expect(page.getByLabel('Search conversations')).toBeVisible();
  await page.locator('.support-inbox-item').click();
  await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: 'Delete this conversation?' });
  await expect(confirmation.getByText(/for both you and the user/)).toBeVisible();
  await confirmation.getByRole('button', { name: 'Cancel' }).click();
  expect(deleted).toHaveLength(0);
  await page.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await confirmation.getByRole('button', { name: 'Delete conversation', exact: true }).click();
  await expect(page.getByText('No conversations yet. Users can contact you from Support.')).toBeVisible();
  expect(deleted).toEqual(['thread']);
});

test('incoming messages do not move a user reading older history or mark unseen replies read', async ({ page }) => {
  const messages = Array.from({ length: 60 }, (_, i) => msg(i + 1, `Reply ${i + 1}: ${'Details about your playback problem. '.repeat(8)}`));
  const reads: number[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/unread')) return json(route, { count: 0 });
    if (url.pathname.endsWith('/read')) { reads.push(route.request().postDataJSON().through); return json(route, {}); }
    const after = Number(url.searchParams.get('after') || 0), before = Number(url.searchParams.get('before') || Infinity);
    const selected = messages.filter((m) => m.id > after && m.id < before);
    return json(route, { conversation: { id: 'thread', userId, status: 'open' }, messages: after ? selected.slice(0, 50) : selected.slice(-50), hasMore: selected.length > 50 });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Load older messages' })).toBeAttached();
  const history = page.getByRole('log', { name: 'Message history' });
  await history.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect(page.getByText(/^Reply 1:/)).toBeAttached();
  messages.push(msg(61, 'A new reply just arrived.'));
  await expect(page.getByRole('button', { name: 'New messages ↓' })).toBeVisible({ timeout: 10000 });
  expect(reads).not.toContain(61);
  await page.getByRole('button', { name: 'New messages ↓' }).click();
  await expect(page.getByText('A new reply just arrived.')).toBeVisible();
  await expect.poll(() => reads.includes(61)).toBe(true);
});

test('users confirm deletion of their own message and can clear their view without losing future replies', async ({ page }) => {
  const messages = [msg(1, 'Support answer'), msg(2, 'My original message', 'user')];
  let revision = 0, cutoff = 0;
  const deletions: string[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/unread')) return json(route, { count: 0, latest: null });
    if (url.pathname.endsWith('/read')) return json(route, {});
    if (request.method() === 'DELETE') {
      deletions.push(url.pathname);
      if (url.pathname.endsWith('/messages/2')) { revision++; messages[1] = { ...messages[1], text: 'Message deleted', deletedAt: '2026-11-01T11:00:00Z' }; }
      else cutoff = 2;
      return json(route, {});
    }
    const version = `${revision}:${cutoff}`, reset = url.searchParams.has('version') && url.searchParams.get('version') !== version;
    const after = reset ? 0 : Number(url.searchParams.get('after') || 0);
    return json(route, { conversation: { id: 'thread', userId, status: 'open' }, messages: messages.filter((m) => m.id > Math.max(after, cutoff)), version, reset, clearedThrough: cutoff, hasMore: false });
  });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Delete your message' })).toHaveCount(1);
  await page.getByRole('button', { name: 'Delete your message' }).click();
  let dialog = page.getByRole('dialog', { name: 'Delete this message?' });
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  expect(deletions).toHaveLength(0);
  await page.getByRole('button', { name: 'Delete your message' }).click();
  await dialog.getByRole('button', { name: 'Delete message', exact: true }).click();
  await expect(page.getByRole('log').getByText('Message deleted', { exact: true })).toBeVisible();
  await expect(page.getByText('My original message', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Delete your message' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear history', exact: true }).click();
  dialog = page.getByRole('dialog', { name: 'Clear chat history?' });
  await expect(dialog.getByText(/support team keeps its copy/)).toBeVisible();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(Math.abs(bounds!.x + bounds!.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(1);
  expect(Math.abs(bounds!.y + bounds!.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(1);
  const clearButton = dialog.getByRole('button', { name: 'Clear history', exact: true });
  await expect(clearButton).toHaveCSS('background-color', 'rgb(190, 57, 57)');
  expect((await clearButton.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: '/tmp/evolix-support-confirm.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBounds = await dialog.boundingBox();
  expect(Math.abs(mobileBounds!.y + mobileBounds!.height / 2 - 844 / 2)).toBeLessThanOrEqual(1);
  expect(mobileBounds!.width).toBeLessThanOrEqual(390 - 32);
  await expect(clearButton).toBeVisible();
  await dialog.getByRole('button', { name: 'Clear history', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How can we help?' })).toBeVisible();
  expect(messages).toHaveLength(2); // history clearing preserves the support team's copy
  messages.push(msg(3, 'A new support reply'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.getByText('A new support reply', { exact: true })).toBeVisible();
  await expect(page.getByText('Support answer', { exact: true })).toHaveCount(0);
});

test('the bell combines announcements and support replies, marks them read, and refreshes when the user returns', async ({ page }) => {
  const messages = [msg(1, 'Your issue is being checked.'), msg(2, 'Playback is fixed now.')];
  let through = 0, announcementRead = false;
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/announcements/read')) { announcementRead = true; return json(route, {}); }
    if (url.pathname.endsWith('/announcements')) return json(route, { unread: announcementRead ? 0 : 1, items: [{ id: 'announcement', title: 'Platform update', body: 'A new update', publishedAt: '2026-11-01T10:30:00Z', priority: 'inbox', read: announcementRead }] });
    if (url.pathname.endsWith('/unread')) {
      const unread = messages.filter((m) => m.id > through);
      return json(route, { count: unread.length, latest: unread.at(-1) ?? null });
    }
    if (url.pathname.endsWith('/read')) { through = Math.max(through, request.postDataJSON().through); return json(route, {}); }
    const after = Number(url.searchParams.get('after') || 0);
    return json(route, { conversation: { id: 'thread', userId, status: 'open' }, messages: messages.filter((m) => m.id > after), hasMore: false, version: '0:0' });
  });
  await page.goto('/?dashboard=1');
  const bell = page.getByRole('button', { name: /^Notifications/ });
  await expect(bell).toHaveAccessibleName('Notifications, 3 unread');
  await bell.click();
  const notifications = page.getByRole('dialog', { name: 'Notifications' });
  await expect(notifications.getByText('Evolix Support replied')).toBeVisible();
  await expect(notifications.getByText('Playback is fixed now.')).toBeVisible();
  await expect(notifications.getByText('Platform update')).toBeVisible();
  expect(through).toBe(0); // opening the bell does not mark support messages read
  await notifications.getByRole('button', { name: 'Mark all as read' }).click();
  await expect(bell).toHaveAccessibleName('Notifications');
  expect(through).toBe(2); expect(announcementRead).toBe(true);
  messages.push(msg(3, 'Please let us know if you need anything else.'));
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(bell).toHaveAccessibleName('Notifications, 1 unread');
  await notifications.getByRole('button', { name: /Evolix Support replied/ }).click();
  await expect(page).toHaveURL(/\/support$/);
  await expect(page.getByRole('heading', { name: 'Evolix Support', exact: true })).toBeVisible();
  await expect.poll(() => through).toBe(3);
  await expect(page.getByRole('button', { name: /^Notifications/ })).toHaveAccessibleName('Notifications');
});

test('a delayed history page cannot restore text deleted in another session', async ({ page }) => {
  const messages = Array.from({ length: 60 }, (_, i) => msg(i + 1, i === 0 ? 'Private original text' : `Message ${i + 1}`));
  let revision = 0;
  let releaseOlder: (() => void) | undefined;
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/unread')) return json(route, { count: 0, latest: null });
    if (url.pathname.endsWith('/read')) return json(route, {});
    const version = `${revision}:0`;
    const reset = url.searchParams.has('version') && url.searchParams.get('version') !== version;
    const before = Number(url.searchParams.get('before') || Infinity);
    const after = reset ? 0 : Number(url.searchParams.get('after') || 0);
    const eligible = messages.filter((m) => m.id < before && m.id > after);
    const snapshot = eligible.slice(-50).map((m) => ({ ...m }));
    if (url.searchParams.has('before')) await new Promise<void>((resolve) => { releaseOlder = resolve; });
    return json(route, { conversation: { id: 'thread', userId, status: 'open' }, messages: snapshot, version, reset, clearedThrough: 0, hasMore: eligible.length > 50 });
  });
  await page.goto('/');
  const history = page.getByRole('log');
  await expect(page.getByRole('button', { name: 'Load older messages' })).toBeAttached();
  await history.evaluate((el) => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
  await page.getByRole('button', { name: 'Load older messages' }).click();
  await expect.poll(() => Boolean(releaseOlder)).toBe(true);
  revision = 1;
  messages[0] = { ...messages[0], text: 'Message deleted', deletedAt: '2026-11-01T11:00:00Z' };
  messages[59] = { ...messages[59], text: 'Message deleted', deletedAt: '2026-11-01T11:00:00Z' };
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(history.getByText('Message deleted', { exact: true })).toHaveCount(1);
  releaseOlder!();
  await expect(page.getByRole('button', { name: 'Load older messages' })).toBeEnabled();
  await expect(history.getByText('Private original text', { exact: true })).toHaveCount(0);
});
