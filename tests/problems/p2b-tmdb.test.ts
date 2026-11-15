import { afterEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ tags: vi.fn(), life: vi.fn(), fetch: vi.fn() }));
vi.mock('next/cache', () => ({ cacheTag: state.tags, cacheLife: state.life }));
vi.mock('@/lib/config', () => ({ getConfig: async () => ({ TMDB_API_KEY: 'test-credential' }) }));
import { getMovieSummary, getShowSeason, getShowSummary } from '@/lib/tmdb';

function respond(body: object) {
  state.fetch.mockResolvedValue({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal('fetch', state.fetch);
}
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

describe('narrow viewer TMDB requests', () => {
  it('reads show metadata and season counts in one request with no season fanout', async () => {
    respond({ id: 42, name: 'Many seasons', seasons: [{ season_number: 3, episode_count: 8 }], last_episode_to_air: { season_number: 3, episode_number: 5 } });
    const show = await getShowSummary(42);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(state.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/3/tv/42');
    expect(url.searchParams.get('append_to_response')).toBe('credits,images');
    expect(show.seasons[0]).toMatchObject({ seasonNumber: 3, episodeCount: 8 });
    expect(show.lastEpisode).toEqual({ seasonNumber: 3, episodeNumber: 5 });
    expect(state.tags).toHaveBeenCalledWith('catalog', 'tmdb:tv:42');
    expect(state.life).toHaveBeenCalledTimes(1);
  });
  it('requests no appended payload for watch metadata', async () => {
    respond({ id: 42, name: 'Show' });
    await getShowSummary(42, 'watch');
    expect(new URL(state.fetch.mock.calls[0][0]).searchParams.has('append_to_response')).toBe(false);
    await getMovieSummary(42, 'watch');
    expect(new URL(state.fetch.mock.calls[1][0]).searchParams.has('append_to_response')).toBe(false);
  });
  it('fetches exactly the requested season without appended images or credits', async () => {
    respond({ episodes: [{ id: 9, episode_number: 2, name: 'Second', air_date: '2020-01-01', runtime: 30 }] });
    expect(await getShowSeason(42, 3)).toEqual([{ tmdbId: 9, episodeNumber: 2, name: 'Second', overview: '', airDate: '2020-01-01', runtimeMinutes: 30, stillPath: null, isVisible: true }]);
    expect(state.fetch).toHaveBeenCalledTimes(1);
    const url = new URL(state.fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/3/tv/42/season/3');
    expect([...url.searchParams.keys()]).toEqual(['api_key']);
    expect(state.tags).toHaveBeenCalledWith('catalog', 'tmdb:tv:42');
  });
});
