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
  await page.getByLabel('Your message').fill('Episode 6 is not available.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Retry send' })).toBeVisible();
  await expect(page.getByLabel('Your message')).toHaveValue('Episode 6 is not available.');
  await page.getByRole('button', { name: 'Retry send' }).click();
  await expect(page.getByLabel('Your message')).toHaveValue('');
  await expect(page.getByText('Episode 6 is not available.', { exact: true })).toHaveCount(1);
  expect(attempts).toHaveLength(2); expect(attempts[0]).toBe(attempts[1]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: '/tmp/evolix-support-mobile.png', fullPage: true });
});

test('admins can select a user, start a conversation, and resolve it', async ({ page }) => {
  const messages: SupportMessage[] = [];
  let status = 'open';
  await page.route('**/api/**', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname.endsWith('/unread')) return json(route, { count: 0 });
    if (url.pathname.endsWith('/read')) return json(route, {});
    if (url.searchParams.has('directory')) return json(route, { users: [{ id: userId, email: 'viewer@test.invalid' }] });
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
  await page.screenshot({ path: '/tmp/evolix-support-admin.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('button', { name: '← Inbox' })).toBeVisible();
  await expect(page.getByLabel('Search conversations')).not.toBeVisible();
  await page.getByRole('button', { name: '← Inbox' }).click();
  await expect(page.getByLabel('Search conversations')).toBeVisible();
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
