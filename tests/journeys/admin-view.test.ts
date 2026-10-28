import { describe, expect, it } from 'vitest';
import { attentionItems, engineState, groupSettings, healthLine, shortEngine, type EngineCard } from '@/lib/evo/admin-view';

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
    expect(healthLine([card()])).toEqual({ level: 'ok', text: 'All good' });
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
