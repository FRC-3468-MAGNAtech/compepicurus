// P25: practice streaks, in the viewer's local time. A "day" is a local calendar date; the streak is the run of
// consecutive days with at least one completed session. It is still alive if the last such day is today or yesterday.

const DAY_MS = 86_400_000;

/** Local calendar day number (days since 1970-01-01 in local time), so a DST change can't merge or split days. */
export function localDayNumber(iso: string): number | null {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  const d = new Date(t);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS);
}

export function uniqueDays(isoDates: (string | null | undefined)[]): number[] {
  const set = new Set<number>();
  for (const iso of isoDates) {
    if (!iso) continue;
    const n = localDayNumber(iso);
    if (n !== null) set.add(n);
  }
  return [...set].sort((a, b) => a - b);
}

/** The streak ending today (or yesterday, if nothing yet today): 0 when the last practice day is older. */
export function currentStreak(isoDates: (string | null | undefined)[], now: Date = new Date()): number {
  const days = uniqueDays(isoDates);
  if (days.length === 0) return 0;
  const today = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
  let i = days.length - 1;
  if (days[i] !== today && days[i] !== today - 1) return 0;
  let streak = 1;
  while (i > 0 && days[i - 1] === days[i] - 1) {
    streak += 1;
    i -= 1;
  }
  return streak;
}

/** The longest run of consecutive days ever. */
export function longestStreak(isoDates: (string | null | undefined)[]): number {
  const days = uniqueDays(isoDates);
  let best = 0;
  let run = 0;
  for (let i = 0; i < days.length; i++) {
    run = i > 0 && days[i - 1] === days[i] - 1 ? run + 1 : 1;
    best = Math.max(best, run);
  }
  return best;
}
