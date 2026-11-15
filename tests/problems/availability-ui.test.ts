import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShowDetail } from '@/lib/viewer/detail';

const state = vi.hoisted(() => ({ episode: vi.fn(), ensure: vi.fn(), watch: vi.fn() }));
vi.mock('@/lib/viewer/watch', () => ({ getEpisodeWatch: state.episode }));
vi.mock('@/lib/evo/ensure', () => ({ ensureEpisode: state.ensure }));
vi.mock('@/lib/viewer/user', () => ({ currentUserId: async () => 'viewer' }));
vi.mock('@/lib/viewer/access', () => ({ canWatch: async () => true }));
vi.mock('@/lib/viewer/library', () => ({ resumePosition: vi.fn() }));
vi.mock('@/app/(viewer)/_components/watch-view', () => ({ WatchView: state.watch }));
// The page reads cookies concurrently with the catalog lookup; there is no request scope in a unit test.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { EpisodeRow, Seasons } from '@/app/(viewer)/_components/seasons';
import WatchEpisodePage from '@/app/(viewer)/watch/tv/[id]/[season]/[episode]/page';

describe('upcoming episodes in the viewer', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-31T12:00:00Z'));
    vi.clearAllMocks();
  });
  afterEach(() => vi.useRealTimers());

  const episode = (airDate: string | null) => ({ episodeNumber: 6, name: 'Episode 6', airDate, runtimeMinutes: 40, stillPath: null });

  it('shows a scheduled date without a watch link or play icon', () => {
    const html = renderToStaticMarkup(createElement(EpisodeRow, { showId: 'tmdb-1', seasonNumber: 1, ep: episode('2026-11-07') }));
    expect(html).toContain('Coming soon · Nov 7, 2026');
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href=');
    expect(html).not.toContain('v-ep-play');
  });

  it('keeps released episodes playable', () => {
    const html = renderToStaticMarkup(createElement(EpisodeRow, { showId: 'tmdb-1', seasonNumber: 1, ep: episode('2026-10-31') }));
    expect(html).toContain('href="/watch/tv/tmdb-1/1/6"');
    expect(html).toContain('v-ep-play');
    expect(html).not.toContain('Coming soon');
  });

  it('disables an entirely upcoming season, including a stale resume link', () => {
    const show = { id: 'tmdb-1', posterPath: null, seasons: [{ id: 's1', seasonNumber: 1, name: 'Season 1', airDate: '2026-11-07', posterPath: null, firstEpisode: null, episodeCount: 10, upcomingCount: 10 }] } as unknown as ShowDetail;
    const html = renderToStaticMarkup(createElement(Seasons, { show, resumeHref: '/watch/tv/tmdb-1/1/1' }));
    expect(html).toContain('0 available · 10 coming soon');
    expect(html).toContain('From Nov 7, 2026');
    expect(html).not.toContain('href=');
  });

  it('stops a direct watch URL before catalog creation or mounting the player', async () => {
    state.episode.mockResolvedValue({ current: { id: 'tmdb-ep-1-1-6', tmdbId: 1, showName: 'Weekly show', seasonNumber: 1, episodeNumber: 6, name: 'Episode 6', airDate: '2026-11-07' }, prev: null, next: null });
    const view = await WatchEpisodePage({ params: Promise.resolve({ id: 'tmdb-1', season: '1', episode: '6' }), searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(view);
    expect(html).toContain('Coming soon · Nov 7, 2026');
    expect(html).toContain('Back to Weekly show');
    expect(state.ensure).not.toHaveBeenCalled();
    expect(state.watch).not.toHaveBeenCalled();
  });
});
