import { expect, test, type Page } from '@playwright/test';
import { mergeJourneys, summarize, type EngineJourney, type JourneyTask } from '../../lib/evo/journeys';

const T0 = Date.parse('2026-10-28T10:00:00Z');
const iso = (s: number) => new Date(T0 + s * 1000).toISOString().replace('Z', '');
let n = 0;
const task = (start: number, over: Partial<JourneyTask> = {}): JourneyTask => ({ task_id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, quality: '720p', resolved_quality: '720p', status: 'FAILED', cache_failed: false, message: '', created_at: iso(start), updated_at: iso(start + 30), ready_at: null, watchable: false, steps: {}, failed_step: null, failed_detail: '', ...over });
const win = (start: number, wait = 10) => task(start, { status: 'STREAMING', watchable: true, ready_at: iso(start + wait), steps: { request: 'ok', extract: 'ok', stream: 'ok' } });
const bad = (start: number, step: string, detail: string) => task(start, { failed_step: step, failed_detail: detail, steps: { [step]: 'failed' } });
const journey = (tmdb: number, title: string, tasks: JourneyTask[], over: Partial<EngineJourney> = {}): EngineJourney => ({ tmdb_id: tmdb, media_type: 'movie', season: null, episode: null, kind: 'video', title, tasks, ...over });

const report = (hours: number) => {
  const a = [
    journey(1, 'Interstellar', [win(0, 12)]),
    journey(2, 'Toy Story 5', [win(0, 20)]),
    journey(3, 'Prison Break', [bad(0, 'extract', 'All stream extractors failed')], { media_type: 'tv', season: 1, episode: 1 }),
    journey(4, 'Jailer 2', [bad(0, 'extract', 'No streams found for media'), bad(100, 'extract', 'No streams found for media')]),
    journey(5, 'Money Heist', [task(0, { status: 'EXTRACTING', steps: { extract: 'running' } })]),
    ...(hours === 168 ? [journey(6, 'Old Movie A', [win(0)]), journey(7, 'Old Movie B', [win(0)]), journey(8, 'Old Movie C', [win(0)])] : []),
  ];
  // Prison Break failed on engine A, then worked on engine B: one journey across two engines.
  const b = [journey(3, 'Prison Break', [win(120, 15)], { media_type: 'tv', season: 1, episode: 1 }), journey(9, 'Verify Trouble', [bad(0, 'verify', 'Downloaded file is too short'), win(200, 8)])];
  return summarize(mergeJourneys([{ engineId: 'a', engineName: 'Engine A', journeys: a }, { engineId: 'b', engineName: 'Engine B', journeys: b }]), hours);
};

async function open(page: Page) {
  const asked: number[] = [];
  await page.route('**/api/admin/evo/journeys*', (route) => {
    const hours = Number(new URL(route.request().url()).searchParams.get('hours'));
    asked.push(hours);
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, report: report(hours) }) });
  });
  await page.goto('/journeys.html');
  return asked;
}
const card = (page: Page, name: string) => page.getByRole('button', { name: new RegExp(`^\\d+\\s*${name}`) });

test('shows how viewers ended up: success rate, the four outcomes, worst first', async ({ page }) => {
  await open(page);
  // 5 titles: Interstellar, Toy Story 5 smooth; Prison Break + Verify Trouble struggled; Jailer 2 never; Money Heist trying.
  await expect(page.getByRole('status').first()).toContainText('80%');
  await expect(page.getByRole('status').first()).toContainText('of 5');
  await expect(card(page, 'Watched smoothly')).toContainText('2');
  await expect(card(page, 'Watched after trouble')).toContainText('2');
  await expect(card(page, 'Never got it')).toContainText('1');
  await expect(card(page, 'Still trying')).toContainText('1');
  const rows = page.locator('tbody tr');
  await expect(rows.first()).toContainText('Jailer 2'); // never got it comes first
  await expect(rows.first()).toContainText('Extract streams: No streams found');
});

test('failed tries that ended in a watch are folded into one row, and expand to every try', async ({ page }) => {
  await open(page);
  await card(page, 'Watched after trouble').click();
  await expect(page.locator('tbody tr')).toHaveCount(2); // Prison Break once, not once per try
  const prison = page.locator('tbody tr', { hasText: 'Prison Break' });
  await expect(prison).toContainText('Watched after trouble');
  await expect(prison).toContainText('S1E1');
  await expect(prison.getByRole('button', { name: /Show 2 tries/ })).toBeVisible();
  await prison.getByRole('button', { name: /Show 2 tries/ }).click();
  await expect(page.locator('tr.j-tries')).toHaveCount(2);
  await expect(page.locator('tr.j-tries').first()).toContainText('Engine A');
  await expect(page.locator('tr.j-tries').first()).toContainText('Extract streams: All stream extractors failed');
  await expect(page.locator('tr.j-tries').nth(1)).toContainText('Engine B'); // the retry on another engine
  await expect(page.locator('tr.j-tries').nth(1)).toContainText('watchable');
});

test('the graph marks a step viewers recovered from, and red only where they stay stuck', async ({ page }) => {
  await open(page);
  const verify = page.getByRole('button', { name: /^Verify:/ });
  await expect(verify).toHaveAttribute('data-state', 'recovered'); // failed once, still watched
  await expect(verify).toContainText('↻ 1');
  // Jailer 2 is stuck at Extract for good, while Money Heist is still running there: red wins over "running".
  const extract = page.getByRole('button', { name: /^Extract streams:/ });
  await expect(extract).toHaveAttribute('data-state', 'failed');
  await expect(extract).toContainText('✗ 1');
  await expect(extract).toContainText('↻ 1'); // Prison Break failed here on engine A, then worked on engine B
});

test('switching to 7 days asks for that window and updates the numbers', async ({ page }) => {
  const asked = await open(page);
  await expect(card(page, 'Watched smoothly')).toContainText('2');
  await page.getByRole('button', { name: 'Last 7 days' }).click();
  await expect(card(page, 'Watched smoothly')).toContainText('5');
  expect(asked).toContain(168);
  await expect(page.getByRole('button', { name: 'Last 7 days' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: 'Last 24 hours' })).toHaveAttribute('aria-pressed', 'false');
});

test('search narrows the titles, and the steps can be shown as a graph', async ({ page }) => {
  await open(page);
  await page.getByRole('searchbox', { name: 'Search titles' }).fill('prison');
  await expect(page.locator('tbody tr')).toHaveCount(1);
  await expect(page.locator('tbody tr').first()).toContainText('Prison Break');
  await page.getByRole('searchbox', { name: 'Search titles' }).fill('nothing like this');
  await expect(page.getByText('No title matches')).toBeVisible();

  await expect(page.locator('.flow-svg')).toHaveCount(0); // a list of steps first
  await page.getByRole('button', { name: 'Show as graph' }).click();
  await expect(page.locator('.flow-svg')).toBeVisible();
  await expect(page.getByRole('button', { name: /^Verify:/ })).toHaveAttribute('data-state', 'recovered');
});

test('screenshot for humans (SHOT=/path/to/file.png)', async ({ page }) => {
  test.skip(!process.env.SHOT, 'only runs when asked for a picture');
  await page.setViewportSize({ width: 1400, height: 1500 });
  await open(page);
  await page.locator('tbody tr', { hasText: 'Prison Break' }).getByRole('button', { name: /Show 2 tries/ }).click();
  await page.screenshot({ path: process.env.SHOT!, fullPage: true });
});
