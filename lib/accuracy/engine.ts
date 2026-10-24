/**
 * Shared accuracy engine — the one place this math lives. Match Analytics
 * (lib/analytics/accuracy.ts) wraps `computeAllianceAccuracy` to add its own
 * richer status states (needs-robots/awaiting-results/not-applicable) on
 * top; practice/live scoring (P4+) can call this directly, since it never
 * has a `ScoutEntry[]` to look robots up from — just whatever scores the
 * session already knows.
 */

export type AllianceAccuracyInput = {
  /** One entry per robot on the alliance (FTC alliances are 2 robots) — already resolved by the caller. */
  robotScores: number[];
  /** Points awarded to this alliance from the opponent's penalties — already folded into `officialScore` by the FIRST API, included here separately per the accuracy formula. See docs/ASSUMPTIONS.md (P3) for which raw API field this comes from. */
  penaltyPoints: number;
  officialScore: number;
};

export type AllianceAccuracyOutput = {
  /** 0-100. */
  accuracy: number;
  scoutedTotal: number;
  officialScore: number;
  penaltyPoints: number;
  /** Signed: scoutedTotal - officialScore (positive = over-counted, negative = under-counted). */
  difference: number;
};

/**
 * `scoutedTotal = sum(robotScores) + penaltyPoints`
 * `accuracy = max(0, 1 - abs(officialScore - scoutedTotal) / officialScore) * 100`
 * `officialScore === 0` -> 100 if `scoutedTotal` is also 0, else 0.
 */
export function computeAllianceAccuracy({ robotScores, penaltyPoints, officialScore }: AllianceAccuracyInput): AllianceAccuracyOutput {
  const scoutedTotal = robotScores.reduce((sum, s) => sum + s, 0) + penaltyPoints;
  const difference = scoutedTotal - officialScore;
  const accuracy =
    officialScore === 0 ? (scoutedTotal === 0 ? 100 : 0) : Math.max(0, 1 - Math.abs(difference) / officialScore) * 100;
  return { accuracy, scoutedTotal, officialScore, penaltyPoints, difference };
}

export type AccuracyStatusId = "mentor-intervention" | "student-intervention" | "good" | "excellent";

export type AccuracyStatusInfo = {
  id: AccuracyStatusId;
  label: string;
  /** For coloring text/icons. */
  textClassName: string;
  /** For a pill/badge — same bg/15 + text + border/30 convention as lib/roles.ts. */
  badgeClassName: string;
};

// Fixed, non-theme-derived colors (same reasoning as lib/roles.ts: these are
// semantic status colors, not a tint of the active theme's accent) — and
// written as complete literal class names, not built with template strings,
// so Tailwind's compiler actually picks them up.
const ACCURACY_STATUS_TIERS: Array<{ max: number; info: AccuracyStatusInfo }> = [
  {
    max: 50,
    info: {
      id: "mentor-intervention",
      label: "Mentor Intervention",
      textClassName: "text-red-400",
      badgeClassName: "bg-red-500/15 text-red-300 border border-red-400/30",
    },
  },
  {
    max: 74,
    info: {
      id: "student-intervention",
      label: "Student Intervention",
      textClassName: "text-orange-400",
      badgeClassName: "bg-orange-500/15 text-orange-300 border border-orange-400/30",
    },
  },
  {
    max: 89,
    info: {
      id: "good",
      label: "Good",
      textClassName: "text-cyan-400",
      badgeClassName: "bg-cyan-500/15 text-cyan-300 border border-cyan-400/30",
    },
  },
  {
    max: 100,
    info: {
      id: "excellent",
      label: "Excellent",
      textClassName: "text-lime-400",
      badgeClassName: "bg-lime-500/15 text-lime-300 border border-lime-400/30",
    },
  },
];

/** Rounds to the nearest integer first, then buckets: 0-50 Mentor Intervention, 51-74 Student Intervention, 75-89 Good, 90-100 Excellent. */
export function getStatus(accuracy: number): AccuracyStatusInfo {
  const rounded = Math.round(accuracy);
  const tier = ACCURACY_STATUS_TIERS.find((t) => rounded <= t.max) ?? ACCURACY_STATUS_TIERS[ACCURACY_STATUS_TIERS.length - 1];
  return tier.info;
}

const PERCENT_COLOR_TIERS: Array<{ max: number; className: string }> = [
  { max: 74, className: "text-red-400" },
  { max: 84, className: "text-orange-400" },
  { max: 94, className: "text-yellow-400" },
  { max: 100, className: "text-green-400" },
];

/** A simpler 4-band coloring (0-74 red, 75-84 orange, 85-94 yellow, 95-100 green) — distinct from getStatus()'s tiers/labels, for contexts that just want "how good is this number" shading without the status wording. */
export function getPercentColor(accuracy: number): string {
  const rounded = Math.round(accuracy);
  const tier = PERCENT_COLOR_TIERS.find((t) => rounded <= t.max) ?? PERCENT_COLOR_TIERS[PERCENT_COLOR_TIERS.length - 1];
  return tier.className;
}

export type RankedItem<T> = { item: T; rank: number | null };

/**
 * Ranks `items` by `valueFn` descending (higher value = better rank — the
 * common case for accuracy/score leaderboards). Ties share a rank and the
 * next rank skips accordingly (1, 2, 2, 4). Items with no value (`null`)
 * always rank last and get `rank: null` (display "?"), regardless of their
 * position in the input array.
 */
export function rankWithTies<T>(items: T[], valueFn: (item: T) => number | null): RankedItem<T>[] {
  const withValues = items.map((item) => ({ item, value: valueFn(item) }));
  const ranked = withValues.filter((w) => w.value !== null) as Array<{ item: T; value: number }>;
  const unranked = withValues.filter((w) => w.value === null);

  ranked.sort((a, b) => b.value - a.value);

  const results: RankedItem<T>[] = [];
  let lastValue: number | null = null;
  let lastRank = 0;
  let position = 0;
  for (const { item, value } of ranked) {
    position++;
    if (value !== lastValue) {
      lastRank = position;
      lastValue = value;
    }
    results.push({ item, rank: lastRank });
  }
  for (const { item } of unranked) {
    results.push({ item, rank: null });
  }
  return results;
}
