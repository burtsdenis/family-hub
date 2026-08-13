/**
 * A subset of RRULE from RFC 5545: FREQ and INTERVAL.
 * We need no more — "pay once a month" and "renew once a year" are fully
 * covered by this, while full RRULE drags in a library and a whole class
 * of edge cases.
 */

export type Freq = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';

export interface Recurrence {
  freq: Freq;
  interval: number;
}

const FREQS: Freq[] = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'];

export function parseRecurrence(rule: string | null): Recurrence | null {
  if (!rule) return null;
  const parts = Object.fromEntries(
    rule
      .split(';')
      .map((p) => p.split('='))
      .filter((kv): kv is [string, string] => kv.length === 2)
      .map(([k, v]) => [k.toUpperCase(), v.toUpperCase()]),
  );
  const freq = parts['FREQ'] as Freq | undefined;
  if (!freq || !FREQS.includes(freq)) return null;

  const interval = Number(parts['INTERVAL'] ?? 1);
  if (!Number.isInteger(interval) || interval < 1 || interval > 999) return null;

  return { freq, interval };
}

export function isValidRecurrence(rule: string): boolean {
  return parseRecurrence(rule) !== null;
}

/**
 * The date of the k-th occurrence, counted from the start of the series.
 *
 * Counting always starts from the original date, not the previous
 * occurrence. Otherwise "every 31st" slips to the 28th forever after
 * February: Jan 31 → Feb 28 → Mar 28. Correct is Jan 31 → Feb 28 →
 * Mar 31, i.e. the day of month is clamped to the month length anew
 * every time.
 */
function occurrence(anchor: string, rec: Recurrence, k: number): string | null {
  const date = new Date(`${anchor}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;

  switch (rec.freq) {
    case 'DAILY':
      date.setUTCDate(date.getUTCDate() + rec.interval * k);
      break;
    case 'WEEKLY':
      date.setUTCDate(date.getUTCDate() + 7 * rec.interval * k);
      break;
    case 'MONTHLY':
      addMonths(date, rec.interval * k, anchorDay(anchor));
      break;
    case 'YEARLY':
      addMonths(date, 12 * rec.interval * k, anchorDay(anchor));
      break;
  }
  return date.toISOString().slice(0, 10);
}

function anchorDay(anchor: string): number {
  return Number(anchor.slice(8, 10));
}

/** The nearest occurrence strictly after the date `after`. */
export function occurrenceAfter(anchor: string, after: string, rule: string): string | null {
  const rec = parseRecurrence(rule);
  if (!rec) return null;

  for (let k = 1; k <= 5000; k++) {
    const candidate = occurrence(anchor, rec, k);
    if (!candidate) return null;
    if (candidate > after) return candidate;
  }
  return null;
}

/**
 * Adding months with clamping to the last day of the month.
 * The day comes from the start of the series, so Jan 31 + 2 months =
 * Mar 31, even if the intermediate occurrence landed on Feb 28.
 */
function addMonths(date: Date, months: number, day: number): void {
  date.setUTCDate(1);
  date.setUTCMonth(date.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  date.setUTCDate(Math.min(day, lastDay));
}

export function describeRecurrence(rule: string | null): string | null {
  const rec = parseRecurrence(rule);
  if (!rec) return null;
  const { freq, interval } = rec;

  if (interval === 1) {
    return { DAILY: 'Каждый день', WEEKLY: 'Каждую неделю', MONTHLY: 'Каждый месяц', YEARLY: 'Каждый год' }[
      freq
    ];
  }
  const unit = {
    DAILY: ['день', 'дня', 'дней'],
    WEEKLY: ['неделю', 'недели', 'недель'],
    MONTHLY: ['месяц', 'месяца', 'месяцев'],
    YEARLY: ['год', 'года', 'лет'],
  }[freq];

  const abs = interval % 100;
  const last = abs % 10;
  const word =
    abs > 10 && abs < 20 ? unit[2] : last > 1 && last < 5 ? unit[1] : last === 1 ? unit[0] : unit[2];
  return `Каждые ${interval} ${word}`;
}

/**
 * All occurrences of a series that fall within a date range.
 *
 * Events, unlike tasks, are never "closed" — so nothing gets to spawn
 * the next instance, and the series has to be expanded on the fly on
 * every request. Materializing occurrences into the database won't work:
 * "every year" with no end date is an infinite table.
 *
 * Dates in YYYY-MM-DD format, bounds inclusive.
 */
export function expandOccurrences(
  anchor: string,
  rule: string | null,
  from: string,
  to: string,
  limit = 500,
): string[] {
  if (!rule) {
    return anchor >= from && anchor <= to ? [anchor] : [];
  }
  const rec = parseRecurrence(rule);
  if (!rec) return anchor >= from && anchor <= to ? [anchor] : [];

  const result: string[] = [];
  // A ceiling on the step count: protection against "daily since 1990"
  // and against a rule that somehow fails to move the date forward.
  const MAX_STEPS = 20_000;

  for (let k = 0; k < MAX_STEPS; k++) {
    const date = k === 0 ? anchor : occurrence(anchor, rec, k);
    if (!date) break;
    if (date > to) break;
    if (date >= from) {
      result.push(date);
      if (result.length >= limit) break;
    }
  }
  return result;
}
