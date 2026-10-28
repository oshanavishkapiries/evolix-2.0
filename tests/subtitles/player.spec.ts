import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const clip = '/tmp/evolix-subtitle-player-test.mp4';
if (!existsSync(clip)) execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=navy:s=320x180:d=90:r=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clip]);
const EN = { id: '11111111-1111-4111-8111-111111111111', language: 'en', label: 'Best English', format: 'vtt', url: '/english.vtt', source: 'opensubtitles', score: 10, lastUsedAt: '2020-01-01' };
const ALT = { ...EN, id: '22222222-2222-4222-8222-222222222222', label: 'Alternate English', score: 1, lastUsedAt: '2026-01-01' };
const SI = { ...EN, id: '33333333-3333-4333-8333-333333333333', language: 'si', label: 'Sinhala translated', source: 'translation', originTrackId: ALT.id, url: '/sinhala.vtt' };
const UPLOAD = { ...ALT, id: '44444444-4444-4444-8444-444444444444', label: 'my.srt', source: 'upload', visibility: 'private' };
async function setup(page: Page, autoFail = false, seed = false) {
  const calls: { path: string; body: Record<string, unknown> | null }[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const body = route.request().headers()['content-type']?.includes('application/json') ? route.request().postDataJSON() : null;
    calls.push({ path, body });
    let data: unknown = {};
    if (path === '/api/subtitles') data = { tracks: autoFail ? [] : [ALT, EN] };
    if (path === '/api/subtitles/auto') data = { track: null, needsChoice: true, message: 'HTTP 429: automatic candidates failed' };
    if (path === '/api/subtitles/search') data = { candidates: [{ ref: 'signed-candidate', release: 'Release A', downloads: 100, rating: 8, lang: 'en' }] };
    if (path === '/api/subtitles/select') data = { track: EN };
    if (path === '/api/subtitles/upload') data = { track: UPLOAD };
    if (path === '/api/evo/translate') data = { state: 'done', subtitle: SI };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await page.route('**/clip.mp4', (r) => r.fulfill({ path: clip, contentType: 'video/mp4' }));
  await page.route('**/*.vtt', (r) => r.fulfill({ contentType: 'text/vtt', body: 'WEBVTT\n\n00:00:00.000 --> 00:01:30.000\nReadable subtitle\n' }));
  await page.goto(seed ? '/?seed=cached' : '/');
  return calls;
}
async function openMore(page: Page) {
  await page.getByRole('button', { name: 'Dual Subtitles settings' }).click();
  await page.getByRole('button', { name: 'First subtitle · Bottom' }).click();
  await page.getByRole('option', { name: 'More options' }).click();
  await expect(page.getByRole('dialog', { name: 'Subtitle library' })).toBeVisible();
}

test('compact menu ranks by score, alternate choice persists, timing slider works', async ({ page }) => {
  await setup(page, false, true);
  await expect(page.locator(`[data-track-id="${EN.id}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Dual Subtitles settings' }).click();
  await page.getByRole('button', { name: 'First subtitle · Bottom' }).click();
  const options = page.getByRole('listbox').getByRole('option');
  expect(await options.count()).toBeLessThanOrEqual(4);
  await page.getByRole('option', { name: 'More options' }).click();
  await page.getByRole('button', { name: 'Alternate English · OpenSubtitles', exact: true }).click();
  await expect(page.locator(`[data-track-id="${ALT.id}"]`)).toBeVisible();
  await page.reload();
  await expect(page.locator(`[data-track-id="${ALT.id}"]`)).toBeVisible();
  await page.getByRole('button', { name: 'Dual Subtitles settings' }).click();
  await page.getByRole('tab', { name: 'Sync' }).click();
  const slider = page.getByRole('slider', { name: 'Subtitle timing in seconds' });
  await expect(slider).toBeVisible();
  await slider.fill('2.5');
  await expect(slider).toHaveValue('2.5');
});

test('all automatic attempts failing opens the picker and a selected release loads', async ({ page }) => {
  const calls = await setup(page, true);
  await expect(page.getByRole('dialog', { name: 'Subtitle library' })).toBeVisible();
  await page.getByRole('button', { name: /Release A/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator(`[data-track-id="${EN.id}"]`)).toBeVisible();
  expect(calls.some((c) => c.path === '/api/subtitles/select' && c.body?.ref === 'signed-candidate')).toBe(true);
});

test('uploads a private track, reports a problem, and translates the chosen source', async ({ page }) => {
  const calls = await setup(page);
  await expect(page.locator(`[data-track-id="${EN.id}"]`)).toBeVisible();
  await openMore(page);
  await page.getByRole('button', { name: 'Upload my own' }).click();
  await page.getByLabel('Upload subtitle file').setInputFiles({ name: 'my.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:10,000\nHello') });
  await expect(page.locator(`[data-track-id="${UPLOAD.id}"]`)).toBeVisible();
  await openMore(page);
  const alt = page.locator('.v-sub-library-list li').filter({ has: page.getByRole('button', { name: 'Alternate English · OpenSubtitles', exact: true }) });
  await alt.getByText('Subtitle problem?', { exact: true }).click();
  await alt.getByRole('button', { name: 'Out of sync' }).click();
  await expect(page.getByText('Problem reported. Thank you.')).toBeVisible();
  await alt.getByRole('button', { name: 'Translate to Sinhala' }).click();
  await expect.poll(() => calls.find((c) => c.path === '/api/evo/translate')?.body?.sourceTrackId).toBe(ALT.id);
  await expect(page.locator(`[data-track-id="${SI.id}"]`)).toBeVisible();
});
