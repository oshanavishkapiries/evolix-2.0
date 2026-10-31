import { describe, expect, it } from 'vitest';
import { isUpcoming, episodeNeighbors } from '@/lib/viewer/availability';
import { tzDay } from '@/lib/tz';

describe('episode release dates', () => {
  it('uses the Sri Lanka calendar day at the midnight boundary', () => {
    expect(isUpcoming('2026-11-01', tzDay(new Date('2026-10-31T18:29:59Z')))).toBe(true);
    expect(isUpcoming('2026-11-01', tzDay(new Date('2026-10-31T18:30:00Z')))).toBe(false);
  });

  it('allows past dates, today, and unknown dates without treating future dates as released', () => {
    for (const date of ['2026-10-30', '2026-10-31', null, undefined]) {
      expect(isUpcoming(date, '2026-10-31')).toBe(false);
    }
    expect(isUpcoming('2026-11-01', '2026-10-31')).toBe(true);
  });

  it('stops Next at the last aired episode, including across season boundaries', () => {
    const episodes = [
      { seasonNumber: 1, episodeNumber: 4, airDate: '2026-10-24' },
      { seasonNumber: 1, episodeNumber: 5, airDate: '2026-10-31' },
      { seasonNumber: 1, episodeNumber: 6, airDate: '2026-11-07' },
      { seasonNumber: 2, episodeNumber: 1, airDate: '2027-01-01' },
    ];
    expect(episodeNeighbors(episodes, episodes[1], '2026-10-31')).toEqual({ prev: episodes[0], next: null });
    expect(episodeNeighbors(episodes, episodes[1], '2026-11-07').next).toBe(episodes[2]);
    expect(episodeNeighbors(episodes, episodes[2], '2026-10-31')).toEqual({ prev: null, next: null });
    expect(episodes).toHaveLength(4); // upcoming episodes remain available for the panel
  });
});
