import { describe, expect, it } from 'vitest';
import { expandOccurrences, occurrenceAfter, parseRecurrence } from './recurrence.js';

describe('parseRecurrence', () => {
  it('understands FREQ and INTERVAL in any case', () => {
    expect(parseRecurrence('FREQ=MONTHLY;INTERVAL=2')).toEqual({ freq: 'MONTHLY', interval: 2 });
    expect(parseRecurrence('freq=weekly')).toEqual({ freq: 'WEEKLY', interval: 1 });
  });

  it('rejects garbage', () => {
    expect(parseRecurrence('FREQ=SOMETIMES')).toBeNull();
    expect(parseRecurrence('INTERVAL=3')).toBeNull();
    expect(parseRecurrence('FREQ=DAILY;INTERVAL=0')).toBeNull();
    expect(parseRecurrence('FREQ=DAILY;INTERVAL=1000')).toBeNull();
    expect(parseRecurrence('')).toBeNull();
    expect(parseRecurrence(null)).toBeNull();
  });
});

describe('series anchor semantics', () => {
  it('"every 31st" does not slip forever after February', () => {
    // Counted from the anchor, not the previous occurrence: 31.01 → 28.02 → 31.03
    const dates = expandOccurrences('2026-01-31', 'FREQ=MONTHLY;INTERVAL=1', '2026-01-01', '2026-05-31');
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('leap-year February yields the 29th', () => {
    const dates = expandOccurrences('2027-12-31', 'FREQ=MONTHLY;INTERVAL=1', '2028-02-01', '2028-02-29');
    expect(dates).toEqual(['2028-02-29']);
  });

  it('a yearly series from Feb 29 clamps to the 28th in a non-leap year', () => {
    const dates = expandOccurrences('2028-02-29', 'FREQ=YEARLY;INTERVAL=1', '2029-01-01', '2029-12-31');
    expect(dates).toEqual(['2029-02-28']);
  });
});

describe('expandOccurrences', () => {
  it('without a rule — only the anchor itself, and only inside the range', () => {
    expect(expandOccurrences('2026-08-12', null, '2026-08-01', '2026-08-31')).toEqual(['2026-08-12']);
    expect(expandOccurrences('2026-08-12', null, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('range bounds are inclusive', () => {
    const dates = expandOccurrences('2026-08-01', 'FREQ=WEEKLY;INTERVAL=1', '2026-08-08', '2026-08-15');
    expect(dates).toEqual(['2026-08-08', '2026-08-15']);
  });

  it('respects limit', () => {
    const dates = expandOccurrences('2020-01-01', 'FREQ=DAILY;INTERVAL=1', '2020-01-01', '2030-01-01', 10);
    expect(dates).toHaveLength(10);
  });
});

describe('occurrenceAfter', () => {
  it('strictly after the given date', () => {
    expect(occurrenceAfter('2026-01-15', '2026-01-15', 'FREQ=MONTHLY;INTERVAL=1')).toBe('2026-02-15');
    expect(occurrenceAfter('2026-01-15', '2026-02-14', 'FREQ=MONTHLY;INTERVAL=1')).toBe('2026-02-15');
  });
});
