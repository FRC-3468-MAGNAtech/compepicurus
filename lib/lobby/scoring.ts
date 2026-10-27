import { computeAllianceAccuracy } from "@/lib/accuracy/engine";
import { evaluatePracticeSessionFlags } from "@/lib/practice-flags";
import type { LibraryMatch } from "@/lib/match-library";
import type { AllianceColor, SessionFlag, SessionMode } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";

export type LobbyPairScoringPatch = {
  accuracy: number;
  scoutedTotal: number;
  officialScore: number;
  penaltyPoints: number;
  flags: SessionFlag[];
};

/**
 * Computes what both of a pair's two sessions get written with, once both
 * of their entries exist — pure, so it's identical whether called from the
 * client (right after the second of a pair submits) or from
 * `resolveLobbyResults` (Admin SDK, the actual writer — see
 * docs/ASSUMPTIONS.md, P8, for why a pair's own two sessions can't just
 * write this onto each other directly under firestore.rules). Unlike live
 * mode's `resolveLiveAllianceScoring`, a library match's official score is
 * always already known, so this never returns null.
 *
 * Reuses `evaluatePracticeSessionFlags` exactly like solo mode (Zero
 * Entries / Unrealistic Entry / Repeat Attempt); `videoProgressAtFinish` is
 * always `null` — see docs/ASSUMPTIONS.md (P8) for why "Finished Early"
 * doesn't carry over to lobby mode's per-player video model.
 */
export function resolveLobbyPairScoring(
  match: LibraryMatch,
  alliance: AllianceColor,
  entries: [ScoutEntry, ScoutEntry],
  mode: SessionMode,
  priorCompletedAttempt: boolean
): LobbyPairScoringPatch {
  const officialAlliance = match.alliances[alliance];
  const { accuracy, scoutedTotal } = computeAllianceAccuracy({
    robotScores: entries.map((e) => e.score.total),
    penaltyPoints: officialAlliance.penaltyPoints,
    officialScore: officialAlliance.score,
  });

  const flags = evaluatePracticeSessionFlags({
    entries,
    mode,
    videoProgressAtFinish: null,
    priorCompletedAttempt,
  }).map((f) => ({ ...f, dismissed: false }));

  return { accuracy, scoutedTotal, officialScore: officialAlliance.score, penaltyPoints: officialAlliance.penaltyPoints, flags };
}
