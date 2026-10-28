import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const clip = '/tmp/evolix-subtitle-player-test.mp4';
if (!existsSync(clip)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:d=90:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip]);

const BUSY = { ok: false, code: 'BUSY', title: 'We’re very busy right now', message: 'Lots of people are watching. We’ll keep trying for you.', error: 'Lots of people are watching. We’ll keep trying for you.', retryAfter: 5 };
const STARTED = { task_id: 'task-1', status: 'COMPLETED', result_url: 'https://pixeldrain.com/api/file/ready' };

/** `answers` is what each successive POST /api/evo/ingest returns; the last one repeats. */
async function open(page: Page, answers: (({ status: number; body: unknown }) | 'abort')[], statusBody?: unknown) {
  const calls = { ingest: 0 };
  await page.clock.install();
  await page.route('**/api/evo/ingest', (route) => {
    const answer = answers[Math.min(calls.ingest++, answers.length - 1)];
    if (answer === 'abort') return route.abort('failed');
    return route.fulfill({ status: answer.status, contentType: 'application/json', headers: answer.status === 503 ? { 'Retry-After': '5' } : {}, body: JSON.stringify(answer.body) });
  });
  if (statusBody) await page.route('**/api/evo/status/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(statusBody) }));
  await page.route('**/api/file/ready', (r) => r.fulfill({ path: clip, contentType: 'video/mp4' }));
  await page.goto('/evo.html');
  return calls;
}
const scene = (page: Page) => page.getByRole('status');

test('busy servers show a calm waiting scene, count down, retry by themselves and then play', async ({ page }) => {
  const calls = await open(page, [{ status: 503, body: BUSY }, { status: 503, body: BUSY }, { status: 200, body: STARTED }]);
  await expect(page.getByText('We’re very busy right now')).toBeVisible();
  await expect(scene(page)).toContainText(/Trying again in \d+s/);
  await expect(scene(page)).toContainText('Retry 1 of 6');
  await expect(page.getByRole('alert')).toHaveCount(0); // waiting is not an error
  await page.clock.runFor(8000);
  await expect.poll(() => calls.ingest).toBe(2);
  await expect(scene(page)).toContainText('Retry 2 of 6');
  await page.clock.runFor(15000);
  await expect(page.locator('[data-media-player]')).toHaveCount(1);
  expect(calls.ingest).toBe(3);
  await expect(page.getByText(/Evo engine|HTTP 503/)).toHaveCount(0);
});

test('"Try now" skips the countdown', async ({ page }) => {
  const calls = await open(page, [{ status: 503, body: BUSY }, { status: 200, body: STARTED }]);
  await page.getByRole('button', { name: 'Try now' }).click();
  await expect(page.locator('[data-media-player]')).toHaveCount(1);
  expect(calls.ingest).toBe(2);
});

test('after six busy retries it stops and says so, with a Try again button', async ({ page }) => {
  const calls = await open(page, [{ status: 503, body: BUSY }]);
  for (let i = 0; i < 8 && (await page.getByText('still very busy').count()) === 0; i++) await page.clock.runFor(90_000);
  await expect(page.getByText(/still very busy/)).toBeVisible();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  expect(calls.ingest).toBe(7); // the first try plus six retries
  await page.clock.runFor(300_000);
  expect(calls.ingest).toBe(7); // and it really stopped
});

test('an unknown failure shows a plain sentence and a reference, never the raw text', async ({ page }) => {
  await open(page, [{ status: 502, body: { ok: false, code: 'UNKNOWN', title: 'Something went wrong on our side', message: 'We’ve been told about it. Please try again in a moment.', ref: 'AB12CD' } }]);
  await expect(page.getByText('Something went wrong on our side')).toBeVisible();
  await expect(page.getByText('Reference: AB12CD')).toBeVisible();
  await expect(page.getByText(/Traceback|KeyError|HTTP 502/)).toHaveCount(0);
});

test('a failed task shows the friendly title and sentence from the server', async ({ page }) => {
  await open(page, [{ status: 200, body: { task_id: 'task-2', status: 'PENDING' } }], { status: 'FAILED', code: 'NO_SOURCE', title: 'No playable copy yet', message: 'We couldn’t find a copy of this to play right now. Try again later, or pick another source.' });
  await page.clock.runFor(2000);
  await expect(page.getByText('No playable copy yet')).toBeVisible();
  await expect(page.getByText(/pick another source/)).toBeVisible();
});

test('offline: says so, and carries on by itself when the connection returns', async ({ page }) => {
  const calls = await open(page, ['abort', { status: 200, body: STARTED }]);
  await expect(page.getByText('Can’t reach our servers')).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('[data-media-player]')).toHaveCount(1);
  expect(calls.ingest).toBe(2);
});
