export const APP_TZ = process.env.APP_TIMEZONE ?? "Asia/Kolkata";

/** YYYY-MM-DD in the app's timezone (decks roll over at local midnight). */
export function todayStr(d: Date = new Date(), tz: string = APP_TZ): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return t.toISOString().slice(0, 10);
}

/** Consecutive days with activity ending today (or yesterday, so the streak survives until tonight). */
export function streakFrom(days: string[], today: string): number {
  const set = new Set(days);
  let cur = set.has(today) ? today : addDays(today, -1);
  let n = 0;
  while (set.has(cur)) {
    n++;
    cur = addDays(cur, -1);
  }
  return n;
}
