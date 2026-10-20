import type { FtcMatch } from "@/lib/ftc/types";
import type { AccuracyResult, ScoutEntry } from "@/lib/scout-entries";

function latestEntryForTeam(entries: ScoutEntry[], teamNumber: number): ScoutEntry | null {
  const candidates = entries.filter((e) => e.teamNumber === teamNumber && !e.excluded);
  if (candidates.length === 0) return null;
  return candidates.reduce((latest, e) => (e.submittedAt > latest.submittedAt ? e : latest));
}

/**
 * Accuracy formula (see ftc-match-analytics-prompt.md):
 *   scoutedTotal = sum(robot scores) + penaltyPoints
 *   accuracy = max(0, 1 - abs(officialScore - scoutedTotal) / officialScore)
 *   officialScore === 0 -> 1 if scoutedTotal is also 0, else 0
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
  const scoutedTotal = robotEntries.reduce((sum, e) => sum + e!.score.total, 0) + resolvedPenalty;
  const value =
    officialScore === 0 ? (scoutedTotal === 0 ? 1 : 0) : Math.max(0, 1 - Math.abs(officialScore - scoutedTotal) / officialScore);

  return { status: "complete", value, scoutedTotal, penaltyPoints: resolvedPenalty, officialScore };
}

/** Which alliance (and its official score/penalty) a team belongs to on a given match. */
export function allianceForTeam(match: FtcMatch, teamNumber: number): "red" | "blue" | null {
  if (match.redTeams.includes(teamNumber)) return "red";
  if (match.blueTeams.includes(teamNumber)) return "blue";
  return null;
}
