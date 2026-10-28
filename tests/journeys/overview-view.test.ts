import { expect, it } from 'vitest';
import { compareWindows, engineTone, errorTone, reportTone } from '@/lib/cms/overview-view';

it('compares the last 7 days with the 7 before, summed or averaged', () => {
  const days = [1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2];
  expect(compareWindows(days)).toEqual({ now: 14, before: 7, change: 100 });
  expect(compareWindows(days, 7, true)).toEqual({ now: 2, before: 1, change: 100 });
  expect(compareWindows([0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0]).change).toBeNull(); // nothing to compare with
});

it('colours each area by whether someone should look', () => {
  expect(errorTone({ open: 0, new24: 0 })).toBe('ok');
  expect(errorTone({ open: 4, new24: 0 })).toBe('warn');
  expect(errorTone({ open: 4, new24: 1 })).toBe('bad');
  expect(errorTone(null)).toBe('warn');
  expect(reportTone({ open: 2, new24: 0 })).toBe('warn');
  expect(engineTone(2, 2)).toBe('ok');
  expect(engineTone(1, 2)).toBe('warn');
  expect(engineTone(0, 2)).toBe('bad');
});
