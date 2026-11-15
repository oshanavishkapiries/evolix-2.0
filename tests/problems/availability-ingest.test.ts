import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  context: vi.fn(), claim: vi.fn(), fetch: vi.fn(), record: vi.fn(),
}));
vi.mock('@/lib/evo/context', () => ({ titleContext: state.context }));
vi.mock('@/lib/evo/client', () => ({ engineFetch: state.fetch, EngineUnavailableError: class extends Error {} }));
vi.mock('@/lib/evo/promote', () => ({ promote: vi.fn(), promotionFromTask: () => null }));
vi.mock('@/lib/evo/scheduler', () => ({
  claimEngine: state.claim, recordTask: state.record, recordSubtitleOwners: vi.fn(), markUnhealthy: vi.fn(),
  ingestKey: () => 'test-claim', ingestAffinity: () => 'test-affinity', NoEngineAvailableError: class extends Error {},
}));

import { startIngest } from '@/lib/evo/ingest';

describe('blocking extraction before an episode airs', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    vi.clearAllMocks();
    state.context.mockResolvedValue({ airDate: '2026-11-07', runtimeMinutes: 40, synopsis: '', characters: [], title: 'Weekly show', imdbId: null });
    state.claim.mockResolvedValue({ id: 'test-engine' });
    state.fetch.mockResolvedValue(Response.json({ task_id: 'test-task' }));
  });
  afterEach(() => vi.useRealTimers());

  it('returns Coming soon without claiming an engine, calling it, or recording a task', async () => {
    expect(await startIngest({ tmdbId: 1, mediaType: 'tv', quality: '720p', season: 1, episode: 6 })).toMatchObject({
      kind: 'error', status: 409, body: { code: 'NOT_AIRED', title: 'Coming soon' },
    });
    expect(state.claim).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
  });

  it('allows the episode on its air date', async () => {
    vi.setSystemTime(new Date('2026-11-06T18:30:00Z'));
    expect(await startIngest({ tmdbId: 1, mediaType: 'tv', quality: '720p', season: 1, episode: 6 })).toMatchObject({ kind: 'started' });
    expect(state.fetch).toHaveBeenCalledOnce();
  });

  it('preserves playback for episodes with unknown dates', async () => {
    state.context.mockResolvedValue({ airDate: null, runtimeMinutes: 40, synopsis: '', characters: [], title: 'Older show', imdbId: null });
    expect(await startIngest({ tmdbId: 1, mediaType: 'tv', quality: '720p', season: 1, episode: 6 })).toMatchObject({ kind: 'started' });
  });

  it('refuses a movie before its release date the same way', async () => {
    state.context.mockResolvedValue({ airDate: '2026-12-25', runtimeMinutes: 120, synopsis: '', characters: [], title: 'Holiday film', imdbId: null });
    expect(await startIngest({ tmdbId: 2, mediaType: 'movie', quality: '720p' })).toMatchObject({ kind: 'error', status: 409, body: { code: 'NOT_AIRED' } });
    expect(state.claim).not.toHaveBeenCalled();
    expect(state.fetch).not.toHaveBeenCalled();
  });
});
