import type { AllianceColor } from "@/lib/practice-sessions";

export type CoveredRobot = { teamNumber: number; alliance: AllianceColor };

export type JoinOption =
  | { kind: "forced"; alliance: AllianceColor; teamNumber: number }
  | { kind: "choice"; alliance: AllianceColor; teamNumbers: [number, number] }
  | { kind: "none" };

/**
 * What a new joiner is offered, given who's already covering this match
 * (active scouts + already-completed entries, this team only). Per the
 * prompt: the first joiner completing an alliance is *forced* onto that
 * alliance's other robot (no free choice); only once an alliance is fully
 * covered can further joiners pick freely from the other alliance. If both
 * alliances are already partially covered (1 each) — a case the prompt
 * doesn't address — this forces onto the first one found, favoring
 * completing an alliance over starting a third; see docs/ASSUMPTIONS.md
 * (P7).
 */
export function determineJoinOption(covered: CoveredRobot[], redTeams: [number, number], blueTeams: [number, number]): JoinOption {
  const byAlliance: Record<AllianceColor, number[]> = {
    red: covered.filter((c) => c.alliance === "red").map((c) => c.teamNumber),
    blue: covered.filter((c) => c.alliance === "blue").map((c) => c.teamNumber),
  };
  const teams: Record<AllianceColor, [number, number]> = { red: redTeams, blue: blueTeams };

  if (byAlliance.red.length === 0 && byAlliance.blue.length === 0) return { kind: "none" };

  for (const alliance of ["red", "blue"] as AllianceColor[]) {
    if (byAlliance[alliance].length === 1) {
      const remaining = teams[alliance].find((t) => !byAlliance[alliance].includes(t));
      if (remaining !== undefined) return { kind: "forced", alliance, teamNumber: remaining };
    }
  }

  for (const [alliance, other] of [
    ["red", "blue"],
    ["blue", "red"],
  ] as [AllianceColor, AllianceColor][]) {
    if (byAlliance[alliance].length === 2 && byAlliance[other].length === 0) {
      return { kind: "choice", alliance: other, teamNumbers: teams[other] };
    }
  }

  return { kind: "none" };
}
