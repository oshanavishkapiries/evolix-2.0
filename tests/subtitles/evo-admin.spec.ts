import { expect, test, type Page } from '@playwright/test';
import { mergeJourneys, summarize, type EngineJourney, type JourneyTask } from '../../lib/evo/journeys';
import type { EngineCard } from '../../lib/evo/admin-view';

const T0 = Date.parse('2026-10-28T10:00:00Z');
const iso = (s: number) => new Date(T0 + s * 1000).toISOString().replace('Z', '');
let n = 0;
const task = (start: number, over: Partial<JourneyTask> = {}): JourneyTask => ({ task_id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, quality: '720p', resolved_quality: '720p', status: 'FAILED', cache_failed: false, message: '', created_at: iso(start), updated_at: iso(start + 30), ready_at: null, watchable: false, steps: {}, failed_step: null, failed_detail: '', ...over });
const win = (start: number, wait = 10) => task(start, { status: 'STREAMING', watchable: true, ready_at: iso(start + wait), steps: { request: 'ok', extract: 'ok', resolve: 'ok', stream: 'ok', webhook: 'ok' } });
const bad = (start: number, step: string, detail: string) => task(start, { failed_step: step, failed_detail: detail, steps: { request: 'ok', [step]: 'failed' } });
const journey = (tmdb: number, title: string, tasks: JourneyTask[], over: Partial<EngineJourney> = {}): EngineJourney => ({ tmdb_id: tmdb, media_type: 'movie', season: null, episode: null, kind: 'video', title, tasks, ...over });

const report = summarize(mergeJourneys([
  { engineId: 'a', engineName: 'oshan', journeys: [journey(1, 'Interstellar', [win(0, 12)]), journey(2, 'Toy Story 5', [win(0, 20)]), journey(4, 'Jailer 2', [bad(0, 'extract', 'No streams found for media'), bad(100, 'extract', 'No streams found for media')]), journey(5, 'Money Heist', [task(0, { status: 'EXTRACTING', steps: { request: 'ok', extract: 'running' } })], { media_type: 'tv', season: 2, episode: 3 })] },
  { engineId: 'b', engineName: 'evolix', journeys: [journey(3, 'Prison Break', [bad(0, 'verify', 'Downloaded file is too short'), win(120, 15)], { media_type: 'tv', season: 1, episode: 1 }), journey(6, 'VisionQuest', [win(0, 9)], { media_type: 'tv', season: 1, episode: 1, kind: 'sinhala' })] },
]), 24);

const host = (ip: string, name: string) => ({ name: `${name}-evoengine-x-${ip.replaceAll('.', '-')}.sslip.io`, url: `http://${name}-evoengine-x-${ip.replaceAll('.', '-')}.sslip.io` });
const cards: EngineCard[] = [
  { id: 'a', ...host('38.242.251.70', 'oshan'), available: true, draining: false, safeToRemove: false, lastOkAt: '2026-10-29T00:47:00Z', lastError: null, activeJobs: 1, queueDepth: 3, freeDiskGb: 106, failures: 2, queue: { paused: false, waiting_extraction: 3, extracting: 1, caching: 0, queue_limit: 50 }, providers: [{ name: 'CineSrcStreamExtractor', state: 'healthy', cooling_until: null, recent_failures: 0 }, { name: 'YtHdStreamExtractor', state: 'cooling', cooling_until: 1793239920, recent_failures: 3 }] },
  { id: 'b', ...host('161.97.135.43', 'evolix'), available: true, draining: false, safeToRemove: false, lastOkAt: '2026-10-29T00:47:00Z', lastError: null, activeJobs: 0, queueDepth: 0, freeDiskGb: 131, failures: 0, queue: { paused: false, waiting_extraction: 0, extracting: 0, caching: 0, queue_limit: 50 }, providers: [{ name: 'CineSrcStreamExtractor', state: 'healthy', cooling_until: null, recent_failures: 0 }, { name: 'YtHdStreamExtractor', state: 'healthy', cooling_until: null, recent_failures: 1 }] },
];
const settings = [
  ['MAX_CONCURRENT_EXTRACTIONS', 'Parallel extractions', 'Headless-browser extractions running at once.', 2, 2],
  ['MAX_CONCURRENT_DOWNLOADS', 'Parallel CDN caches', 'Downloads/uploads to the CDN running at once.', 2, 2],
  ['MAX_QUEUED_TASKS', 'Queue limit', 'Jobs waiting for extraction beyond this are refused with 503.', 50, 50],
  ['MIN_FREE_DISK_GB', 'Minimum free disk (GB)', 'CDN caching is skipped below this much free disk.', 10, 10],
  ['PROVIDER_COOLDOWN_S', 'Provider cool-down (s)', 'How long a failing provider is skipped before one trial request.', 600, 300],
  ['BROWSER_POOL_SIZE', 'Browser pool size', 'Long-lived headless browsers shared by extractions.', 2, 2],
  ['TRANSLATE_DAILY_BUDGET_USD', 'Daily translation budget (USD)', '0 = unlimited. Spend is always ledgered.', 0, 0],
].map(([key, label, description, value, def]) => ({ key, label, description, kind: 'int', min: 0, max: 5000, choices: [], value, default: def, overridden: value !== def }));
const choice = { key: 'EXTRACTOR_ORDER', label: 'Provider order', description: 'Which stream provider is tried first.', kind: 'choice', min: 0, max: 0, choices: [{ value: 'cinesrc,ythd', label: 'CineSrc first, then YtHD' }, { value: 'ythd,cinesrc', label: 'YtHD first, then CineSrc' }], value: 'cinesrc,ythd', default: 'cinesrc,ythd', overridden: false };
const metrics = { window_hours: 24, providers: { CineSrcStreamExtractor: { attempts: 14, ok: 12, failed: 2, browser_launches: 1, duration_s: { median: 8.2, p95: 19.5 }, peak_rss_mb: { median: 410, p95: 620 }, cpu_s: { median: 3.1, p95: 7.4 } } } };

async function mock(page: Page) {
  await page.route('**/api/admin/evo/**', (route) => {
    const p = new URL(route.request().url()).pathname;
    const data = p.endsWith('/journeys') ? null : p.endsWith('/queue') ? cards[0].queue : p.endsWith('/providers') ? cards[0].providers : p.endsWith('/metrics') ? metrics : p.endsWith('/config') ? [...settings.slice(0, 4), choice, ...settings.slice(4)] : {};
    const body = p.endsWith('/journeys') ? { ok: true, report, cards } : { data };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('the overview answers "is it OK?" first: health, what needs a person, then each engine', async ({ page }) => {
  await mock(page);
  await page.goto('/evo-admin.html');
  await expect(page.locator('.health')).toContainText('Needs a look');
  const attention = page.locator('.attn-list li');
  await expect(attention.first()).toContainText('Jailer 2: viewers never got it');
  await expect(page.locator('.attn-list')).toContainText('YtHd on oshan is cooling down');
  await expect(page.getByRole('article', { name: 'Engine oshan' })).toContainText('38.242.251.70');
  await expect(page.getByRole('article', { name: 'Engine evolix' })).toContainText('161.97.135.43');
});

test('screenshots for humans (SHOT=/dir)', async ({ page }) => {
  test.skip(!process.env.SHOT, 'only runs when asked for pictures');
  await mock(page);
  for (const [name, url, width] of [['overview', '/evo-admin.html', 1440], ['engine', '/evo-admin.html?view=engine', 1440], ['settings', '/evo-admin.html?view=engine&tab=settings', 1440], ['overview-phone', '/evo-admin.html', 390]] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url);
    await page.waitForTimeout(800);
    if (name === 'settings') await page.getByLabel('Parallel extractions').fill('3');
    await page.screenshot({ path: `${process.env.SHOT}/${name}.png`, fullPage: true });
  }
});
