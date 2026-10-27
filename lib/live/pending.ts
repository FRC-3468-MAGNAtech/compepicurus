import type { AllianceColor, PracticeSession } from "@/lib/practice-sessions";
import type { MatchType } from "@/lib/ftc/types";

export type PendingLiveRobot = {
  /** The scout's own completed session for the sibling robot — not the pending one itself (there's no session for that yet). */
  sessionId: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  alliance: AllianceColor;
  /** The uncovered robot this scout could go scout. */
  teamNumber: number;
  /** Both teams on the alliance (the same pair stored on the original session), for starting the new session without a fresh match lookup. */
  allianceTeams: [number, number];
  streamUrl: string | null;
  streamStartSec: number | null;
};

/**
 * "If nobody scouts the other robot on a scout's alliance, that scout may
 * scout it later" — one entry per one of *this* scout's own completed live
 * sessions whose alliance partner robot nobody on the team (any scout, not
 * just this one) has covered yet, active or completed.
 */
export function computePendingLiveRobots(teamLiveSessions: PracticeSession[], uid: string): PendingLiveRobot[] {
  const mine = teamLiveSessions.filter(
    (s) => s.uid === uid && s.kind === "live" && s.status === "completed" && s.allianceTeams && s.eventCode && s.matchType && s.matchNumber !== null
  );

  const results: PendingLiveRobot[] = [];
  for (const s of mine) {
    const myTeam = s.robots[0];
    const otherTeam = s.allianceTeams!.find((t) => t !== myTeam);
    if (otherTeam === undefined) continue;

    const covered = teamLiveSessions.some(
      (o) =>
        o.id !== s.id &&
        o.eventCode === s.eventCode &&
        o.matchType === s.matchType &&
        o.matchNumber === s.matchNumber &&
        o.alliance === s.alliance &&
        o.robots.includes(otherTeam) &&
        (o.status === "completed" || o.status === "in-progress")
    );
    if (covered) continue;

    results.push({
      sessionId: s.id,
      eventCode: s.eventCode!,
      matchType: s.matchType!,
      matchNumber: s.matchNumber!,
      alliance: s.alliance!,
      teamNumber: otherTeam,
      allianceTeams: s.allianceTeams!,
      streamUrl: s.streamUrl,
      streamStartSec: s.streamStartSec,
    });
  }
  return results;
}
