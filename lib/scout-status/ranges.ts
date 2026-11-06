// Range entry for the Scout Status page (P16): "2-4, 8, 10-12" — comma-separated
// ranges and single numbers of official match numbers within one category. A blank
// input means every match in the category. Pure.

export type ParsedRanges = {
  /** True when the text is blank: every match counts. */
  all: boolean;
  /** Merged, sorted, non-overlapping [first, last] pairs. Empty when `all`. */
  ranges: [number, number][];
  /** One message per unreadable chip; `ranges` still holds the readable ones. */
  errors: string[];
};

const CHIP = /^(\d+)(?:\s*-\s*(\d+))?$/;

export function parseRangeText(text: string): ParsedRanges {
  const trimmed = text.trim();
  if (trimmed === "") return { all: true, ranges: [], errors: [] };

  const raw: [number, number][] = [];
  const errors: string[] = [];
  for (const piece of trimmed.split(",")) {
    const chip = piece.trim();
    if (chip === "") continue; // a trailing comma while typing is fine
    const m = CHIP.exec(chip);
    if (!m) {
      errors.push(`"${chip}" isn't a number or a range like 2-4.`);
      continue;
    }
    const start = Number(m[1]);
    const end = m[2] !== undefined ? Number(m[2]) : start;
    if (start < 1 || end < 1) {
      errors.push(`"${chip}": match numbers start at 1.`);
      continue;
    }
    if (end < start) {
      errors.push(`"${chip}": the end is before the start.`);
      continue;
    }
    raw.push([start, end]);
  }

  // Merge overlapping and touching ranges (2-4 and 5-6 read as 2-6).
  raw.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [];
  for (const [s, e] of raw) {
    const last = merged[merged.length - 1];
    if (last && s <= last[1] + 1) last[1] = Math.max(last[1], e);
    else merged.push([s, e]);
  }
  // Only text that produced nothing readable AND nothing wrong (just commas) is also "everything".
  if (merged.length === 0 && errors.length === 0) return { all: true, ranges: [], errors: [] };
  return { all: false, ranges: merged, errors };
}

/** Is `matchNumber` selected? Blank text selects everything. */
export const inRanges = (parsed: ParsedRanges, matchNumber: number): boolean => parsed.all || parsed.ranges.some(([s, e]) => matchNumber >= s && matchNumber <= e);

/** How many of the `available` match numbers the ranges select — the "9 matches selected" chip. */
export const countInRanges = (parsed: ParsedRanges, available: readonly number[]): number => available.filter((n) => inRanges(parsed, n)).length;

/** The normalized text ("2-4, 8, 10-12"), for display after parsing. */
export const formatRanges = (parsed: ParsedRanges): string => (parsed.all ? "" : parsed.ranges.map(([s, e]) => (s === e ? String(s) : `${s}-${e}`)).join(", "));

/** The distinct numbers a Finals range names — used to override finals detection. Null when blank or unreadable. */
export function rangeNumbers(parsed: ParsedRanges, cap: number = 200): Set<number> | null {
  if (parsed.all || parsed.ranges.length === 0) return null;
  const out = new Set<number>();
  for (const [s, e] of parsed.ranges) for (let n = s; n <= e && out.size < cap; n++) out.add(n);
  return out;
}
