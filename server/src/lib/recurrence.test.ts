import { describe, expect, it } from 'vitest';
import { expandOccurrences, occurrenceAfter, parseRecurrence } from './recurrence.js';

describe('parseRecurrence', () => {
  it('понимает FREQ и INTERVAL в любом регистре', () => {
    expect(parseRecurrence('FREQ=MONTHLY;INTERVAL=2')).toEqual({ freq: 'MONTHLY', interval: 2 });
    expect(parseRecurrence('freq=weekly')).toEqual({ freq: 'WEEKLY', interval: 1 });
  });

  it('отклоняет мусор', () => {
    expect(parseRecurrence('FREQ=SOMETIMES')).toBeNull();
    expect(parseRecurrence('INTERVAL=3')).toBeNull();
    expect(parseRecurrence('FREQ=DAILY;INTERVAL=0')).toBeNull();
    expect(parseRecurrence('FREQ=DAILY;INTERVAL=1000')).toBeNull();
    expect(parseRecurrence('')).toBeNull();
    expect(parseRecurrence(null)).toBeNull();
  });
});

describe('семантика якоря серии', () => {
  it('«каждое 31-е» не съезжает навсегда после февраля', () => {
    // Отсчёт от якоря, не от предыдущего повтора: 31.01 → 28.02 → 31.03
    const dates = expandOccurrences('2026-01-31', 'FREQ=MONTHLY;INTERVAL=1', '2026-01-01', '2026-05-31');
    expect(dates).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30', '2026-05-31']);
  });

  it('високосный февраль даёт 29-е', () => {
    const dates = expandOccurrences('2027-12-31', 'FREQ=MONTHLY;INTERVAL=1', '2028-02-01', '2028-02-29');
    expect(dates).toEqual(['2028-02-29']);
  });

  it('годовой повтор с 29 февраля прижимается к 28-му в невисокосный год', () => {
    const dates = expandOccurrences('2028-02-29', 'FREQ=YEARLY;INTERVAL=1', '2029-01-01', '2029-12-31');
    expect(dates).toEqual(['2029-02-28']);
  });
});

describe('expandOccurrences', () => {
  it('без правила — только сам якорь, и только внутри диапазона', () => {
    expect(expandOccurrences('2026-08-12', null, '2026-08-01', '2026-08-31')).toEqual(['2026-08-12']);
    expect(expandOccurrences('2026-08-12', null, '2026-09-01', '2026-09-30')).toEqual([]);
  });

  it('границы диапазона включаются', () => {
    const dates = expandOccurrences('2026-08-01', 'FREQ=WEEKLY;INTERVAL=1', '2026-08-08', '2026-08-15');
    expect(dates).toEqual(['2026-08-08', '2026-08-15']);
  });

  it('уважает limit', () => {
    const dates = expandOccurrences('2020-01-01', 'FREQ=DAILY;INTERVAL=1', '2020-01-01', '2030-01-01', 10);
    expect(dates).toHaveLength(10);
  });
});

describe('occurrenceAfter', () => {
  it('строго позже указанной даты', () => {
    expect(occurrenceAfter('2026-01-15', '2026-01-15', 'FREQ=MONTHLY;INTERVAL=1')).toBe('2026-02-15');
    expect(occurrenceAfter('2026-01-15', '2026-02-14', 'FREQ=MONTHLY;INTERVAL=1')).toBe('2026-02-15');
  });
});
