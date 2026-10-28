import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const clip = '/tmp/evolix-subtitle-player-test.mp4';
if (!existsSync(clip)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:d=90:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip]);

async function open(page: Page, url: string, mock: { tracks?: unknown[] } = {}) {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`${e.name}: ${e.message}`));
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tracks: mock.tracks ?? [] }) }));
  await page.route('**/clip.mp4', (r) => r.fulfill({ path: clip, contentType: 'video/mp4' }));
  await page.route('**/*.vtt', (r) => r.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:01:30.000\nReadable subtitle\n' }));
  await page.goto(url);
  return errors;
}

test('a page hidden and shown again builds a fresh player instead of reusing a destroyed one', async ({ page }) => {
  const errors = await open(page, '/lifecycle.html');
  await expect(page.locator('[data-media-player]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle page' }).click();
  await expect(page.locator('[data-media-player]')).toHaveCount(0);
  await page.waitForTimeout(500); // longer than Vidstack's deferred destroy
  await page.getByRole('button', { name: 'Toggle page' }).click();
  await expect(page.locator('[data-media-player]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (document.querySelector('video') as HTMLVideoElement | null)?.readyState ?? 0)).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});

test('control: the bare player does not survive being hidden and shown (what the wrapper protects against)', async ({ page }) => {
  test.skip(!process.env.PLAYER_ERRORS_CONTROL, 'documents the original failure; run with PLAYER_ERRORS_CONTROL=1');
  const errors = await open(page, '/lifecycle.html?raw=1');
  await expect(page.locator('[data-media-player]')).toHaveCount(1);
  await page.getByRole('button', { name: 'Toggle page' }).click();
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Toggle page' }).click();
  await page.waitForTimeout(500);
  expect(errors.join('\n')).toMatch(/reading 'set'|is not a function/);
});

test('a rival text-track handler cannot push subtitle syncing into a stack overflow', async ({ page }) => {
  const errors = await open(page, '/sync.html');
  await expect.poll(() => page.evaluate(() => (window as unknown as { __player?: { textTracks: { length: number } } }).__player?.textTracks.length ?? 0)).toBe(1);
  // iOS Safari's native tracks answer every mode change with their own: emulate that ping-pong.
  await page.evaluate(() => {
    const tracks = (window as unknown as { __player: { textTracks: EventTarget } }).__player.textTracks;
    tracks.addEventListener('mode-change', (e) => {
      const track = (e as CustomEvent).detail as { kind: string; setMode(m: string): void };
      if (track.kind === 'subtitles' || track.kind === 'captions') track.setMode('showing');
    });
  });
  await page.getByRole('button', { name: 'Subtitles off' }).click();
  await page.waitForTimeout(500);
  expect(errors.filter((e) => /Maximum call stack|RangeError/.test(e))).toEqual([]);
  await expect(page.getByRole('button', { name: 'Subtitles off' })).toBeVisible();
});
