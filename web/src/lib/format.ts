import { intlLocale, tPlural } from './i18n';

/*
  Week start is a device setting, like language: read synchronously at
  module load, changing it reloads the page. The whole calendar grid
  computes days through weekdayIndex/startOfWeek, so only those two are
  parameterized — everything else adjusts on its own.
*/
export type WeekStart = 'mon' | 'sun';

function readWeekStart(): WeekStart {
  try {
    return localStorage.getItem('hub-week-start') === 'sun' ? 'sun' : 'mon';
  } catch {
    return 'mon';
  }
}

export const weekStart: WeekStart = readWeekStart();

export function setWeekStart(next: WeekStart): void {
  try {
    localStorage.setItem('hub-week-start', next);
  } catch {
    // No localStorage — the setting just won't stick
  }
  window.location.reload();
}

/** Weekday shift relative to the week start: 0 is the grid's first day. */
const START_SHIFT = weekStart === 'mon' ? 6 : 0;

/**
 * «14 ноября» / «14 November» — year omitted when it is the current one.
 * Intl knows the Russian genitive itself, no hand-rolled month arrays.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return new Intl.DateTimeFormat(intlLocale, {
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(d);
}

/**
 * Pluralization. Forms are given as the English pair (day/days) —
 * the singular doubles as the key into a language's plural table
 * (see ruPlurals in i18n.ru.ts).
 */
export function plural(n: number, one: string, many: string): string {
  return tPlural(n, [one, many]);
}

export function daysUntil(targetDate: string): number | null {
  if (!targetDate) return null;
  const target = new Date(`${targetDate}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

// ── Calendar dates ────────────────────────────────────────────────────────

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Month names in the nominative case — for calendar headers. */
export const MONTHS_NOM = Array.from({ length: 12 }, (_, m) =>
  capitalize(
    new Intl.DateTimeFormat(intlLocale, { month: 'long' }).format(new Date(Date.UTC(2026, m, 1))),
  ),
);

/** Short weekday names, starting from the configured first day. */
export const WEEKDAYS_SHORT = Array.from({ length: 7 }, (_, i) =>
  capitalize(
    new Intl.DateTimeFormat(intlLocale, { weekday: 'short', timeZone: 'UTC' })
      // January 5, 2026 is a Monday, the 4th a Sunday
      .format(new Date(Date.UTC(2026, 0, (weekStart === 'mon' ? 5 : 4) + i)))
      .replace('.', ''),
  ),
);

/** All date arithmetic in UTC so a DST switch never shifts the grid. */
export function toDate(iso: string): Date {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`);
}

export function toISO(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  const d = toDate(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toISO(d);
}

export function addMonths(iso: string, months: number): string {
  const d = toDate(iso);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return toISO(d);
}

/** First day of the week — per the device setting. */
export function startOfWeek(iso: string): string {
  const d = toDate(iso);
  const shift = (d.getUTCDay() + START_SHIFT) % 7;
  return addDays(iso, -shift);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const d = toDate(iso);
  return toISO(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
}

export function dayNumber(iso: string): number {
  return toDate(iso).getUTCDate();
}

export function weekdayIndex(iso: string): number {
  return (toDate(iso).getUTCDay() + START_SHIFT) % 7;
}

/** Saturday and Sunday — regardless of where the grid starts. */
export function isWeekend(iso: string): boolean {
  const day = toDate(iso).getUTCDay();
  return day === 0 || day === 6;
}

export function monthTitle(iso: string): string {
  const d = toDate(iso);
  const month = MONTHS_NOM[d.getUTCMonth()] ?? '';
  return `${month} ${d.getUTCFullYear()}`;
}

/** «3 — 9 August» or «29 September — 5 October». */
export function rangeTitle(from: string, to: string): string {
  const a = toDate(from);
  const b = toDate(to);
  const left = a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}` : formatDate(from);
  return `${left} — ${formatDate(to)}`;
}

/** From '2026-09-15T10:30' extract '10:30'. */
export function timeOf(value: string): string {
  return value.length > 10 ? value.slice(11, 16) : '';
}

/**
 * DB timestamp rendered in local time.
 * The server writes ISO in UTC without a zone marker, so the zone is
 * appended by hand — otherwise the browser reads the string as local
 * time and an hour goes missing.
 */
export function formatStamp(stored: string): string {
  const iso = stored.includes('T') ? stored : stored.replace(' ', 'T');
  const date = new Date(`${iso}Z`);
  if (Number.isNaN(date.getTime())) return stored;
  return `${formatDate(date.toISOString())}, ${new Intl.DateTimeFormat(intlLocale, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)}`;
}
