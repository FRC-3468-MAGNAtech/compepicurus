import { MAX_PICK_PROBABILITY, MIN_SCALE, TEAM_COUNT_DIVISOR, TINY_PROBABILITY } from "./config";

export * from "./config";

// "Pick %" — see config.ts for why every number here is a tunable estimate.

/** The curve's scale for an event with `teamCount` teams. */
export function pickScale(teamCount: number): number {
  return Math.max(MIN_SCALE, teamCount / TEAM_COUNT_DIVISOR);
}

/**
 * Estimated probability (0-1) that we can pick a candidate, from official
 * ranks. `null` when either rank is unknown.
 *
 * - `gap = candidateRank - ourRank`; a candidate ranked at or above us
 *   (`gap <= 0`) is 0 — they will be picked (or pick) before we can.
 * - otherwise `p = maxP * (1 - exp(-(gap / scale)^2))`: the square makes teams
 *   ranked just below us "very very low" and rises steadily toward `maxP` for
 *   teams ranked well below us.
 */
export function pickLikelihood(candidateRank: number | null, ourRank: number | null, teamCount: number): number | null {
  if (candidateRank === null || ourRank === null) return null;
  const gap = candidateRank - ourRank;
  if (gap <= 0) return 0;
  const scale = pickScale(teamCount);
  return MAX_PICK_PROBABILITY * (1 - Math.exp(-((gap / scale) ** 2)));
}

/** "-" unknown, "0%", "<1%" for a tiny non-zero value, otherwise a whole percent. */
export function formatPickLikelihood(p: number | null): string {
  if (p === null) return "-";
  if (p <= 0) return "0%";
  if (p < TINY_PROBABILITY) return "<1%";
  return `${Math.round(p * 100)}%`;
}

/**
 * Red (0) → green (MAX) as a CSS colour. Pale and mid-lightness so it reads on
 * every theme's dark glass; the percentage is always printed beside it, so the
 * colour is never the only cue.
 */
export function pickLikelihoodColor(p: number | null): string | undefined {
  if (p === null) return undefined;
  const t = Math.max(0, Math.min(1, p / MAX_PICK_PROBABILITY));
  return `hsl(${Math.round(t * 120)} 75% 62%)`;
}

/** The tooltip body: the gap, in words. */
export function describePickGap(candidateRank: number | null, ourRank: number | null): string {
  if (candidateRank === null || ourRank === null) return "Needs both our official rank and theirs.";
  const gap = candidateRank - ourRank;
  if (gap < 0) return `Ranked ${-gap} above us (rank ${candidateRank} vs our ${ourRank}).`;
  if (gap === 0) return `Tied with our rank (${ourRank}).`;
  return `Ranked ${gap} below us (rank ${candidateRank} vs our ${ourRank}).`;
}
