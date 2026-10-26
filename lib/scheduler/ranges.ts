import type { MatchType } from "@/lib/ftc/types";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { MatchInput } from "./types";

const PREFIX_TO_TYPE: Record<string, MatchType> = Object.fromEntries(
  Object.entries(MATCH_TYPE_PREFIX).map(([type, prefix]) => [prefix.toUpperCase(), type as MatchType])
);

export type MatchRange = { matchType: MatchType; start: number; end: number };

const RANGE_PATTERN = /^([A-Za-z])(\d+)(?:-(\d+))?$/;

/** Parses free-text chips like `P12-14, Q17-18, F2-3` into `MatchRange[]`. Unrecognized chips are returned as errors, not silently dropped. */
export function parseMatchRanges(text: string): { ranges: MatchRange[]; errors: string[] } {
  const ranges: MatchRange[] = [];
  const errors: string[] = [];

  for (const raw of text.split(",")) {
    const chip = raw.trim();
    if (!chip) continue;
    const match = RANGE_PATTERN.exec(chip);
    const matchType = match ? PREFIX_TO_TYPE[match[1].toUpperCase()] : undefined;
    if (!match || !matchType) {
      errors.push(`"${chip}" isn't a valid range (expected e.g. "Q12-14" or "F3").`);
      continue;
    }
    const start = Number(match[2]);
    const end = match[3] !== undefined ? Number(match[3]) : start;
    if (end < start) {
      errors.push(`"${chip}": end is before start.`);
      continue;
    }
    ranges.push({ matchType, start, end });
  }

  return { ranges, errors };
}

/** Keeps matches inside any of `ranges`, warning about range bounds that don't correspond to any match actually in `matches`. */
export function filterMatchesByRanges(matches: MatchInput[], ranges: MatchRange[]): { matches: MatchInput[]; warnings: string[] } {
  const warnings: string[] = [];
  for (const range of ranges) {
    const numbersInType = new Set(matches.filter((m) => m.matchType === range.matchType).map((m) => m.matchNumber));
    for (let n = range.start; n <= range.end; n++) {
      if (!numbersInType.has(n)) {
        warnings.push(`${MATCH_TYPE_PREFIX[range.matchType]}${n} doesn't exist in this match source — skipped.`);
      }
    }
  }
  const filtered = matches.filter((m) => ranges.some((r) => r.matchType === m.matchType && m.matchNumber >= r.start && m.matchNumber <= r.end));
  return { matches: filtered, warnings };
}

export function filterMatchesByCategories(matches: MatchInput[], categories: MatchType[]): MatchInput[] {
  return matches.filter((m) => categories.includes(m.matchType));
}
