/**
 * Plain date arithmetic on YYYY-MM-DD strings.
 *
 * In UTC on purpose: these are wall-clock dates with no time of day, and
 * doing the arithmetic in local time makes a DST switch shift a day.
 * Where "today" itself is needed, it comes from today() in db/index.ts —
 * that one must be local, or the hub lives in yesterday after midnight.
 */
export function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
  );
}
