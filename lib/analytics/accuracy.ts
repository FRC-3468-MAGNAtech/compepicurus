import type { FtcMatch } from "@/lib/ftc/types";
import type { AccuracyResult, ScoutEntry } from "@/lib/scout-entries";
import { computeAllianceAccuracy as computeAccuracy } from "@/lib/accuracy/engine";

function latestEntryForTeam(entries: ScoutEntry[], teamNumber: number): ScoutEntry | null {
  const candidates = entries.filter((e) => e.teamNumber === teamNumber && !e.excluded);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, e) => (e.submittedAt > latest.submittedAt ? e : latest));
}

/**
 * Match-Analytics-specific wrapper around the shared engine
 * (lib/accuracy/engine.ts, P3): resolves which entries belong to this
 * alliance and layers Analytics' own "needs-robots"/"awaiting-results"
 * states on top — concepts the generic engine doesn't have, since it just
 * takes raw scores and has no notion of "is a robot's entry missing yet."
 * The underlying math (and this function's own signature/0-1 `value`
 * scale) is unchanged from before the refactor — see docs/ASSUMPTIONS.md
 * (P3) for why the engine itself returns a 0-100 scale instead.
 *
 * Needs both alliance robots scouted (FTC alliances are 2 robots) and an
 * official score before a number can be produced at all.
 */
export function computeAllianceAccuracy(
  allianceTeams: number[],
  officialScore: number | null,
  penaltyPoints: number | null,
  matchEntries: ScoutEntry[]
): AccuracyResult {
  const robotEntries = allianceTeams.map((team) => latestEntryForTeam(matchEntries, team));
  if (allianceTeams.length === 0 || robotEntries.some((e) => e === null)) {
    return { status: "needs-robots", value: null, scoutedTotal: null, penaltyPoints: null, officialScore };
  }
  if (officialScore === null) {
    return { status: "awaiting-results", value: null, scoutedTotal: null, penaltyPoints: penaltyPoints ?? null, officialScore: null };
  }

  const resolvedPenalty = penaltyPoints ?? 0;
  const { accuracy, scoutedTotal } = computeAccuracy({
    robotScores: robotEntries.map((e) => e!.score.total),
    penaltyPoints: resolvedPenalty,
    officialScore,
  });

  return { status: "complete", value: accuracy / 100, scoutedTotal, penaltyPoints: resolvedPenalty, officialScore };
}

/** Which alliance (and its official score/penalty) a team belongs to on a given match. */
export function allianceForTeam(match: FtcMatch, teamNumber: number): "red" | "blue" | null {
  if (match.redTeams.includes(teamNumber)) return "red";
  if (match.blueTeams.includes(teamNumber)) return "blue";
  return null;
}
