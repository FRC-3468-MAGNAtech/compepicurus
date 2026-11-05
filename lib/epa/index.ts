import type { OfficialMatch } from "@/lib/analytics/match-breakdown";

// O. EPA — an "expected points added" rating computed from an event's OFFICIAL
// qualification scores alone (P12). FTC has no Statbotics-style source, and it
// is deliberately independent of our scouting data: the Pick List shows it
// beside the scouted columns as a cross-check. Pure, no I/O.

export type EpaAlliance = {
  teams: number[];
  /** The alliance's score with the penalty points it was awarded already removed (see `epaMatchesFromOfficial`). */
  score: number;
};

/** One played match, red and blue. */
export type EpaMatch = { red: EpaAlliance; blue: EpaAlliance };

export type EpaResult = {
  /** Team number → rating (points the team is estimated to add to an alliance). Only teams that played at least one match. */
  epa: Map<number, number>;
  /** Team number → matches the rating is built from. */
  matchesPlayed: Map<number, number>;
};

export const DEFAULT_EPA_PASSES = 2;

/** Teams in a 2-robot FTC alliance; also the divisor when spreading an error across the alliance. */
export const DEFAULT_ALLIANCE_SIZE = 2;

/** `max(0.1, 1 / (n + 1))` — the first match moves a rating all the way to fit, later ones nudge it, and it never stops learning. */
export function learningRate(matchesAlreadyPlayed: number): number {
  return Math.max(0.1, 1 / (matchesAlreadyPlayed + 1));
}

/**
 * Online rating update over `matches` **in the order given** (chronological):
 *
 * - every team starts at (average alliance score) / (alliance size);
 * - for each alliance in each match, `predicted` = the sum of its teams'
 *   ratings *before* this match, `error = actual - predicted`, and each team
 *   gets `epa += learningRate(n) * error / allianceSize`, where `n` is how many
 *   matches that team had already played;
 * - both alliances of a match are predicted from the ratings as they stood
 *   before the match, so the order of red/blue can't matter.
 *
 * **Two passes by default** (`DEFAULT_EPA_PASSES`): the second replays the
 * schedule starting from the first pass's ratings, with match counts reset so
 * early matches get the large learning rate again. One pass already meets the
 * accuracy bar (median Spearman 0.946 against hidden strengths, 24 teams × 12
 * matches, noise 8); the second pass measurably helps (minimum over 20 seeds
 * 0.899 → 0.937, and 0.783 → 0.861 for a 6-match event), which is the
 * condition the spec set for allowing it. `passes: 1` gives the plain forward pass.
 */
export function computeEpa(matches: EpaMatch[], options: { passes?: number } = {}): EpaResult {
  const passes = Math.max(1, Math.floor(options.passes ?? DEFAULT_EPA_PASSES));
  const epa = new Map<number, number>();
  const matchesPlayed = new Map<number, number>();
  if (matches.length === 0) return { epa, matchesPlayed };

  const alliances = matches.flatMap((m) => [m.red, m.blue]).filter((a) => a.teams.length > 0);
  const averageScore = alliances.reduce((sum, a) => sum + a.score, 0) / (alliances.length || 1);
  for (const a of alliances) {
    for (const t of a.teams) {
      if (!epa.has(t)) epa.set(t, averageScore / DEFAULT_ALLIANCE_SIZE);
    }
  }

  for (let pass = 0; pass < passes; pass++) {
    const played = new Map<number, number>();
    for (const match of matches) {
      // Predict both alliances from the pre-match ratings, then apply the updates.
      const updates: { team: number; delta: number }[] = [];
      for (const alliance of [match.red, match.blue]) {
        if (alliance.teams.length === 0) continue;
        const predicted = alliance.teams.reduce((sum, t) => sum + (epa.get(t) ?? 0), 0);
        const error = alliance.score - predicted;
        for (const t of alliance.teams) {
          updates.push({ team: t, delta: (learningRate(played.get(t) ?? 0) * error) / alliance.teams.length });
        }
      }
      for (const { team, delta } of updates) {
        epa.set(team, (epa.get(team) ?? 0) + delta);
        played.set(team, (played.get(team) ?? 0) + 1);
      }
    }
    if (pass === passes - 1) for (const [t, n] of played) matchesPlayed.set(t, n);
  }

  return { epa, matchesPlayed };
}

/**
 * The event's played **qualification** matches in chronological order (the
 * qualification schedule is numbered in play order), as `EpaMatch`es.
 *
 * Scores have the penalty points each alliance was *awarded* subtracted
 * (`penaltyPoints`, the FIRST API's foul-points-for-this-alliance field), so
 * an opponent's fouls don't inflate a rating. Where the API gave no penalty
 * figure (`null`) the raw score is used as-is. Playoff, practice, unplayed, and
 * incomplete (an alliance without teams or a score) matches are skipped.
 */
export function epaMatchesFromOfficial(matches: OfficialMatch[]): EpaMatch[] {
  return matches
    .filter((m) => m.matchType === "Qualification" && m.played && m.red.score !== null && m.blue.score !== null && m.red.teams.length > 0 && m.blue.teams.length > 0)
    .sort((a, b) => a.matchNumber - b.matchNumber)
    .map((m) => ({
      red: { teams: m.red.teams, score: Math.max(0, m.red.score! - (m.red.penaltyPoints ?? 0)) },
      blue: { teams: m.blue.teams, score: Math.max(0, m.blue.score! - (m.blue.penaltyPoints ?? 0)) },
    }));
}

/** Ratings as an array of `{ team, epa, matches }`, best first — handy for tests and for ranking. */
export function rankEpa(result: EpaResult): { team: number; epa: number; matches: number }[] {
  return [...result.epa.entries()]
    .map(([team, epa]) => ({ team, epa, matches: result.matchesPlayed.get(team) ?? 0 }))
    .sort((a, b) => b.epa - a.epa || a.team - b.team);
}
