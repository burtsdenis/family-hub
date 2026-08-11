/**
 * Подмножество RRULE из RFC 5545: FREQ и INTERVAL.
 * Больше нам не нужно — «раз в месяц оплатить» и «раз в год продлить»
 * покрываются этим полностью, а полный RRULE тянет за собой библиотеку
 * и целый класс краевых случаев.
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
 * Дата k-го повтора, считая от начала серии.
 *
 * Отсчёт всегда ведётся от исходной даты, а не от предыдущего повтора.
 * Иначе «каждое 31 число» после февраля навсегда съезжает на 28-е:
 * 31 января → 28 февраля → 28 марта. Правильно — 31 января → 28 февраля →
 * 31 марта, то есть день месяца прижимается к длине месяца заново каждый раз.
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

/** Ближайший повтор строго позже даты `after`. */
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
 * Прибавление месяцев с прижатием к последнему дню месяца.
 * День берётся из начала серии, поэтому 31 января + 2 месяца = 31 марта,
 * даже если промежуточный повтор пришёлся на 28 февраля.
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
 * Все повторы серии, попадающие в диапазон дат.
 *
 * События, в отличие от задач, не «закрываются» — поэтому следующий экземпляр
 * порождать некому, и разворачивать серию приходится на лету при каждом
 * запросе. Материализовать повторы в базу нельзя: «каждый год» без конечной
 * даты — это бесконечная таблица.
 *
 * Даты в формате ГГГГ-ММ-ДД, границы включаются.
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
  // Потолок на число шагов: защита от «каждый день с 1990 года» и от
  // правила, которое почему-то не двигает дату вперёд.
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
