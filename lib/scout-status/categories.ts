import type { MatchType } from "@/lib/ftc/types";

// Match categories for the Scout Status page (P16). The playoff bracket is split into
// Semi-Finals and Finals **for this page only**; everywhere else in the app the `F`
// prefix still covers every playoff match. Pure.

export type StatusCategory = "practice" | "qualification" | "semi" | "final";

export const STATUS_CATEGORIES: { id: StatusCategory; label: string; prefix: string }[] = [
  { id: "practice", label: "Practice", prefix: "P" },
  { id: "qualification", label: "Qualifications", prefix: "Q" },
  { id: "semi", label: "Semi-Finals", prefix: "SF" },
  { id: "final", label: "Finals", prefix: "F" },
];

export const CATEGORY_IDS: StatusCategory[] = STATUS_CATEGORIES.map((c) => c.id);
export const categoryInfo = (id: StatusCategory) => STATUS_CATEGORIES.find((c) => c.id === id)!;

/** The least a match must say about itself to be classified. `series` is the FIRST API's playoff series number (null/absent when unknown). */
export type ClassifiableMatch = { matchType: MatchType; matchNumber: number; series?: number | null };

/** "P12", "Q12", "SF5", "F14" — the labels used on this page. */
export const statusMatchLabel = (category: StatusCategory, matchNumber: number): string => `${categoryInfo(category).prefix}${matchNumber}`;

/**
 * Which playoff match numbers are the **Finals**: the final series at the end of
 * the bracket, which can be split into 2-3 matches (e.g. M14 and a possible M15 in
 * the 8-alliance bracket). Rules, in order:
 *  1. An explicit override (the Finals range an admin typed) wins outright.
 *  2. With the FIRST API's series numbers, the Finals are the matches that share the
 *     **highest** series number.
 *  3. Without series data (a manual/library event, or an API payload without them),
 *     the Finals are just the highest-numbered playoff match — a guess, which the
 *     override exists to correct.
 */
export function finalsMatchNumbers(eventMatches: ClassifiableMatch[], override?: ReadonlySet<number> | null): Set<number> {
  if (override && override.size > 0) return new Set(override);
  const playoffs = eventMatches.filter((m) => m.matchType === "Playoff");
  if (playoffs.length === 0) return new Set();

  const withSeries = playoffs.filter((m) => typeof m.series === "number");
  if (withSeries.length > 0) {
    const last = Math.max(...withSeries.map((m) => m.series as number));
    return new Set(withSeries.filter((m) => m.series === last).map((m) => m.matchNumber));
  }
  return new Set([Math.max(...playoffs.map((m) => m.matchNumber))]);
}

/**
 * `classifyMatch(match, eventMatches)` — Practice and Qualification are themselves; a
 * playoff match is Finals if it is in the final series (see `finalsMatchNumbers`),
 * otherwise Semi-Finals. Pass `finalsOverride` (or a precomputed `finals` set when
 * classifying many matches of one event) to avoid recomputing.
 */
export function classifyMatch(match: ClassifiableMatch, eventMatches: ClassifiableMatch[], finalsOverride?: ReadonlySet<number> | null, finals?: ReadonlySet<number>): StatusCategory {
  if (match.matchType === "Practice") return "practice";
  if (match.matchType === "Qualification") return "qualification";
  const finalsSet = finals ?? finalsMatchNumbers(eventMatches, finalsOverride);
  return finalsSet.has(match.matchNumber) ? "final" : "semi";
}
