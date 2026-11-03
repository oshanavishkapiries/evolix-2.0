import { describe, expect, it } from 'vitest';
import { causeOf, groupStuckTitles, failureRate, highFailureRate, relativeAge, topFailingStep, attentionItems, engineState, groupSettings, healthLine, shortEngine, type EngineCard } from '@/lib/evo/admin-view';
import { mergeJourneys, type JourneyTask } from '@/lib/evo/journeys';

const card = (over: Partial<EngineCard> = {}): EngineCard => ({
  id: 'a', name: 'oshan-evoengine-n4l9vv-f76be8-38-242-251-70.sslip.io', url: 'http://oshan-evoengine-n4l9vv-f76be8-38-242-251-70.sslip.io',
  available: true, draining: false, safeToRemove: false, lastOkAt: null, lastError: null, activeJobs: 0, queueDepth: 0, freeDiskGb: 100, failures: 0,
  queue: { paused: false, waiting_extraction: 0, extracting: 0, caching: 0, queue_limit: 50 },
  providers: [{ name: 'CineSrcStreamExtractor', state: 'healthy', cooling_until: null, recent_failures: 0 }],
  ...over,
});

describe('shortEngine', () => {
  it('turns a Coolify sslip hostname into a name and an IP', () => {
    expect(shortEngine('oshan-evoengine-n4l9vv-f76be8-38-242-251-70.sslip.io', 'http://oshan-evoengine-n4l9vv-f76be8-38-242-251-70.sslip.io')).toEqual({ label: 'oshan', host: '38.242.251.70' });
  });
  it('keeps a name that was given, and shows a plain IP address as is', () => {
    expect(shortEngine('Frankfurt', 'http://10.0.0.5:8000')).toEqual({ label: 'Frankfurt', host: '10.0.0.5' });
    expect(shortEngine('engine.example.com', 'https://engine.example.com')).toEqual({ label: 'engine', host: 'engine.example.com' });
  });
});

describe('attention and health', () => {
  it('says nothing when everything is fine', () => {
    expect(attentionItems([card()], [])).toEqual([]);
    expect(healthLine([card()], { never: 0, smooth: 3, struggled: 1, trying: 2 })).toEqual({ level: 'ok', text: 'No titles stuck for viewers · engines 1/1 OK' });
  });
  it('lists what needs a person, worst first', () => {
    const items = attentionItems(
      [card({ queue: { paused: true, waiting_extraction: 0, extracting: 0, caching: 0, queue_limit: 50 }, freeDiskGb: 5, providers: [{ name: 'YtHdStreamExtractor', state: 'cooling', cooling_until: 1, recent_failures: 3 }] }), card({ id: 'b', name: 'B', url: 'http://10.0.0.2', available: false, lastError: 'timeout' })],
      [{ id: 'j', title: 'Jailer 2', detail: 'Extract streams: No streams', href: '/admin/evo/t' }],
    );
    expect(items.map((i) => i.text)).toEqual([
      'B is not answering',
      'Jailer 2: viewers never got it',
      'oshan: queue is paused',
      'oshan: only 5 GB free disk',
      'YtHd on oshan is cooling down',
    ]);
    expect(items.find((i) => i.provider)?.engine).toBe('a'); // the reset button knows where to go
  });
  it('one engine down is a warning, all down is bad', () => {
    expect(healthLine([card(), card({ id: 'b', available: false })]).level).toBe('warn');
    expect(healthLine([card({ available: false })]).level).toBe('bad');
    expect(engineState({ available: true, draining: true, queue: null }).text).toBe('Draining');
  });
});

it('groups settings in a fixed order and keeps unknown ones under Other', () => {
  const groups = groupSettings([{ key: 'BLOCK_ASSETS' }, { key: 'MAX_QUEUED_TASKS' }, { key: 'NEW_THING' }, { key: 'MAX_CONCURRENT_EXTRACTIONS' }]);
  expect(groups.map((g) => [g.title, g.items.map((i) => i.key)])).toEqual([
    ['Capacity', ['MAX_CONCURRENT_EXTRACTIONS', 'MAX_QUEUED_TASKS']],
    ['Browser', ['BLOCK_ASSETS']],
    ['Other', ['NEW_THING']],
  ]);
});


const totals = { never: 0, smooth: 12, struggled: 1, trying: 2 };
describe('combined overview verdict', () => {
  it('is bad when viewers are stuck despite every engine answering', () => {
    expect(healthLine([card(), card({ id: 'b' })], { ...totals, never: 5 })).toEqual({ level: 'bad', text: '5 titles failing for viewers · engines 2/2 OK' });
    expect(healthLine([card()], { ...totals, never: 1 }).text).toContain('1 title failing');
  });
  it('is bad with no engines, even when no titles failed', () => {
    expect(healthLine([], totals).level).toBe('bad');
    expect(healthLine([card({ available: false })], totals).level).toBe('bad');
  });
  it('warns for draining, paused, cooling, trial, low disk and partially unavailable engines', () => {
    for (const e of [
      card({ draining: true }), card({ queue: { ...card().queue!, paused: true } }), card({ freeDiskGb: 5 }),
      card({ providers: [{ name: 'P', state: 'cooling', cooling_until: 1, recent_failures: 3 }] }),
      card({ providers: [{ name: 'P', state: 'trial', cooling_until: null, recent_failures: 1 }] }),
    ]) expect(healthLine([e], totals).level).toBe('warn');
    expect(healthLine([card(), card({ available: false })], totals).level).toBe('warn');
    expect(healthLine([card({ draining: true })], { ...totals, never: 1 }).level).toBe('bad');
  });
  it('warns for a high failure rate or incomplete viewer data', () => {
    expect(healthLine([card()], totals, { failures: { a: { rate: 20, size: 10 } } }).level).toBe('warn');
    expect(healthLine([card()], totals, { viewerIncomplete: true })).toEqual({ level: 'warn', text: 'No titles stuck in available viewer data · engines 1/1 OK' });
  });
  it('does not claim healthy viewer outcomes when their report is missing', () => {
    expect(healthLine([card()], null)).toMatchObject({ level: 'warn', text: 'Viewer outcomes unavailable · engines 1/1 OK' });
  });
});

describe('human causes', () => {
  it('groups extraction failures despite different provider diagnostics', () => {
    expect(causeOf({ step: 'extract', detail: 'All stream extractors failed; provider A timeout' })).toEqual(causeOf({ step: 'extract', detail: 'all stream extractors failed; provider B missing' }));
    expect(causeOf({ step: 'extract', detail: 'All stream extractors failed' })).toMatchObject({ cause: 'No provider could find a stream', hint: expect.stringContaining('retry later or on the other engine') });
  });
  it('explains empty Sinhala model results', () => {
    expect(causeOf({ step: 'translate', detail: 'Sinhala subtitles: model returned no usable translations' })).toMatchObject({ key: 'empty-sinhala', cause: 'Sinhala translation came back empty', hint: expect.stringContaining('OpenRouter') });
  });
  it('uses the step and first clause for unknown errors, clips whole words and handles missing detail', () => {
    expect(causeOf({ step: 'upload', detail: 'HTTP 503; secret diagnostics' }).cause).toBe('Upload video: HTTP 503');
    const long = causeOf({ step: 'verify', detail: 'A long diagnostic '.repeat(15) }).cause;
    expect(long).toMatch(/…$/);
    expect(long.length).toBeLessThanOrEqual('Verify: '.length + 100);
    expect(long).not.toMatch(/diagnos…$/);
    expect(causeOf(null).cause).toBe('Unknown step: No failure detail reported');
    expect(causeOf({ step: 'new-step', detail: '' }).cause).toBe('new-step: No failure detail reported');
  });
});

const failedTry = (id: string, step: string, detail: string, at = '2026-11-03T10:00:00'): JourneyTask => ({
  task_id: id, quality: '720p', resolved_quality: null, status: 'FAILED', cache_failed: false, message: detail,
  created_at: at, updated_at: at, ready_at: null, watchable: false, steps: { [step]: 'failed' }, failed_step: step, failed_detail: detail,
});
const titleJourneys = () => mergeJourneys([{ engineId: 'a', engineName: 'A', journeys: Array.from({ length: 12 }, (_, i) => ({
  tmdb_id: i, media_type: 'movie' as const, season: null, episode: null, kind: 'video' as const, title: `Title ${i}`,
  tasks: [failedTry(`t${i}`, i < 10 ? 'extract' : 'translate', i < 10 ? `All stream extractors failed; provider ${i}` : 'Model returned no usable translations', `2026-11-03T10:${String(i).padStart(2, '0')}:00`)],
})) }]);

describe('stuck cause groups', () => {
  it('keeps every stuck title beyond five or eight and picks the newest age per cause', () => {
    const groups = groupStuckTitles(titleJourneys());
    expect(groups.map((g) => [g.key, g.titles.length])).toEqual([['no-stream', 10], ['empty-sinhala', 2]]);
    expect(groups[0].newestAt).toBe('2026-11-03T10:09:00');
    expect(groups[0].titles.map((j) => j.decisive.task_id)).toContain('t9');
    expect(relativeAge(groups[0].newestAt, Date.parse('2026-11-03T10:21:00Z'))).toBe('12m ago');
  });
  it('excludes titles that recovered or are still trying', () => {
    const list = titleJourneys();
    const extraction = list.filter((j) => j.trouble?.step === 'extract');
    extraction[0].outcome = 'struggled'; extraction[1].outcome = 'trying';
    expect(groupStuckTitles(list).reduce((n, g) => n + g.titles.length, 0)).toBe(10);
    expect(topFailingStep(list)).toEqual({ label: 'Extract streams', count: 8 });
    expect(groupStuckTitles([])).toEqual([]);
    expect(topFailingStep([])).toBeNull();
  });
});

it('calculates failure rates from actual sample sizes and flags worse engines', () => {
  expect(failureRate(2, 10)).toBe(20);
  expect(failureRate(18, 100)).toBe(18);
  expect(failureRate(null, 100)).toBeNull();
  expect(failureRate(0, 0)).toBeNull();
  expect(highFailureRate(10, 9)).toBe(true);
  expect(highFailureRate(8, 4)).toBe(true);
  expect(highFailureRate(4, 3)).toBe(false);
  expect(highFailureRate(0, 0)).toBe(false);
  expect(highFailureRate(1, 0)).toBe(true);
  expect(highFailureRate(null, 0)).toBe(false);
});
