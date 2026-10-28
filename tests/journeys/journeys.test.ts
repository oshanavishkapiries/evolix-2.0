import { describe, expect, it } from 'vitest';
import { mergeJourneys, summarize, waitText, SMOOTH_WAIT_S, type EngineJourney, type JourneyTask } from '@/lib/evo/journeys';

const T0 = Date.parse('2026-10-28T10:00:00Z');
const iso = (seconds: number) => new Date(T0 + seconds * 1000).toISOString().replace('Z', '');
let n = 0;
const task = (startS: number, over: Partial<JourneyTask> = {}): JourneyTask => ({
  task_id: `t${++n}`, quality: '720p', resolved_quality: '720p', status: 'FAILED', cache_failed: false, message: '',
  created_at: iso(startS), updated_at: iso(startS + 30), ready_at: null, watchable: false, steps: {}, failed_step: null, failed_detail: '', ...over,
});
const win = (startS: number, waitS = 10, over: Partial<JourneyTask> = {}) => task(startS, { status: 'STREAMING', watchable: true, ready_at: iso(startS + waitS), steps: { request: 'ok', extract: 'ok', stream: 'ok' }, ...over });
const bad = (startS: number, step: string, detail = 'boom', over: Partial<JourneyTask> = {}) => task(startS, { failed_step: step, failed_detail: detail, steps: { [step]: 'failed' }, ...over });
const journey = (tmdb: number, tasks: JourneyTask[], over: Partial<EngineJourney> = {}): EngineJourney =>
  ({ tmdb_id: tmdb, media_type: 'movie', season: null, episode: null, kind: 'video', title: `Movie ${tmdb}`, tasks, ...over });
const one = (j: EngineJourney, engine = 'a') => mergeJourneys([{ engineId: engine, engineName: engine.toUpperCase(), journeys: [j] }])[0];

describe('the verdict for one journey', () => {
  it('first try, quick: watched smoothly', () => {
    const j = one(journey(1, [win(0, 20)]));
    expect(j).toMatchObject({ outcome: 'smooth', tries: 1, waitSeconds: 20, trouble: null });
  });

  it('first try but a long wait is not smooth', () => {
    const j = one(journey(1, [win(0, SMOOTH_WAIT_S + 1)]));
    expect(j.outcome).toBe('struggled');
    expect(j.trouble?.detail).toMatch(/Took 61s/);
  });

  it('failed twice then worked: watched after trouble, with the tries and the wait counted from the first', () => {
    const j = one(journey(2, [bad(0, 'extract', 'No streams'), bad(120, 'verify', 'too short'), win(300, 15)]));
    expect(j).toMatchObject({ outcome: 'struggled', tries: 3, waitSeconds: 315, recoveredSteps: ['extract', 'verify'] });
    expect(j.trouble).toEqual({ step: 'verify', detail: 'too short' }); // the failure right before the win
    expect(j.decisive.status).toBe('STREAMING');
  });

  it('never worked: stuck, and it names the step and reason of the last try', () => {
    const j = one(journey(3, [bad(0, 'extract', 'first'), bad(100, 'extract', 'All stream extractors failed')]));
    expect(j).toMatchObject({ outcome: 'never', tries: 2, waitSeconds: null });
    expect(j.trouble).toEqual({ step: 'extract', detail: 'All stream extractors failed' });
  });

  it('a try still running is "still trying", even after earlier failures', () => {
    const j = one(journey(4, [bad(0, 'extract'), task(60, { status: 'EXTRACTING', steps: { extract: 'running' } })]));
    expect(j.outcome).toBe('trying');
  });

  it('tries after the first watch do not change the verdict', () => {
    const j = one(journey(5, [win(0, 5), bad(600, 'download', 'later quality failed')]));
    expect(j).toMatchObject({ outcome: 'smooth', tries: 1 });
  });

  it('a stream that works while caching failed still counts as watched', () => {
    const j = one(journey(6, [win(0, 8, { cache_failed: true, message: 'caching skipped' })]));
    expect(j.outcome).toBe('smooth');
  });
});

describe('merging engines', () => {
  it('a try that failed on one engine and worked on another is one journey', () => {
    const [j, ...rest] = mergeJourneys([
      { engineId: 'a', engineName: 'A', journeys: [journey(7, [bad(0, 'extract', 'no streams')])] },
      { engineId: 'b', engineName: 'B', journeys: [journey(7, [win(90, 12)])] },
    ]);
    expect(rest).toHaveLength(0);
    expect(j).toMatchObject({ outcome: 'struggled', tries: 2, waitSeconds: 102 });
    expect(j.tasks.map((t) => t.engineName)).toEqual(['A', 'B']);
  });

  it('keeps different episodes, and video apart from Sinhala subtitles', () => {
    const list = mergeJourneys([{ engineId: 'a', engineName: 'A', journeys: [
      journey(8, [win(0)], { media_type: 'tv', season: 1, episode: 1 }),
      journey(8, [win(0)], { media_type: 'tv', season: 1, episode: 2 }),
      journey(8, [task(0, { status: 'COMPLETED', watchable: true, ready_at: iso(40) })], { media_type: 'tv', season: 1, episode: 1, kind: 'sinhala' }),
    ] }]);
    expect(list).toHaveLength(3);
  });

  it('lists the worst first: never, trying, struggled, smooth', () => {
    const list = mergeJourneys([{ engineId: 'a', engineName: 'A', journeys: [
      journey(1, [win(0, 5)]), journey(2, [bad(0, 'x'), win(50)]), journey(3, [bad(0, 'x')]), journey(4, [task(0, { status: 'PENDING' })]),
    ] }]);
    expect(list.map((j) => j.outcome)).toEqual(['never', 'trying', 'struggled', 'smooth']);
  });
});

describe('the report', () => {
  const report = () => summarize(mergeJourneys([{ engineId: 'a', engineName: 'A', journeys: [
    journey(1, [win(0, 5)]),
    journey(2, [win(0, 25)]),
    journey(3, [bad(0, 'verify', 'short'), win(60, 10)]),
    journey(4, [bad(0, 'extract', 'a'), bad(50, 'extract', 'b')]),
    journey(5, [task(0, { status: 'DOWNLOADING', steps: { download: 'running' } })]),
  ] }]), 24);

  it('counts each journey once, by outcome', () => {
    expect(report().totals).toEqual({ smooth: 2, struggled: 1, never: 1, trying: 1 });
  });

  it('counts steps by the deciding try, so a recovered failure is not a failure', () => {
    const steps = report().summary.steps;
    expect(steps.extract).toMatchObject({ ok: 3, failed: 1 }); // 1,2,3 passed extract in their winning try; 4 died there for good
    expect(steps.verify).toMatchObject({ failed: 0, recovered: 1 }); // journey 3 failed verify once, then got through
    expect(steps.download).toMatchObject({ running: 1 });
  });

  it('gives the median wait of the journeys that ended in a watch', () => {
    expect(report().medianWaitSeconds).toBe(25); // waits: 5, 25, 70
  });

  it('has no median when nobody watched', () => {
    expect(summarize([], 24).medianWaitSeconds).toBeNull();
  });
});

describe('waitText', () => {
  it.each([[null, '—'], [9, '9s'], [75, '1m 15s'], [3725, '1h 2m']])('%s -> %s', (s, text) => expect(waitText(s as number | null)).toBe(text));
});
