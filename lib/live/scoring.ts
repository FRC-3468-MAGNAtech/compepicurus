import { computeAllianceAccuracy } from "@/lib/analytics/accuracy";
import { evaluateAutoFlagRuleIds, type FlagContext } from "@/lib/analytics/flags";
import { evaluatePracticeSessionFlags } from "@/lib/practice-flags";
import type { FtcMatch } from "@/lib/ftc/types";
import type { AllianceColor, SessionFlag } from "@/lib/practice-sessions";
import type { AccuracyResult, AutoFlag, ScoutEntry } from "@/lib/scout-entries";

export type LiveScoringPatch = {
  sessionAccuracy: number | null;
  sessionScoutedTotal: number | null;
  sessionOfficialScore: number | null;
  sessionPenaltyPoints: number | null;
  sessionFlags: SessionFlag[];
  entryAccuracy: AccuracyResult;
  /** Keyed by `ScoutEntry.id`. */
  entryAutoFlags: Record<string, AutoFlag[]>;
};

/**
 * Computes everything that needs writing once a live alliance is fully
 * scouted (one entry per robot) and the official match has posted scores
 * — shared by the immediate client-side check (right after a scout
 * submits) and the server-side `/api/cron/poll-live-scores` /
 * `/api/live/check-scores` routes (Admin SDK). Pure — no Firestore access
 * — so it's identical either way and fully unit-testable. Returns `null`
 * if the match hasn't posted a score yet; the caller is expected to have
 * already confirmed both entries exist.
 *
 * Session flags reuse P4's `evaluatePracticeSessionFlags` directly (Zero
 * Entries / Unrealistic Entry — the only two of its four flags that make
 * sense here: live matches have no video to finish early against, and
 * "repeat attempt" doesn't apply to a real match that only happens once).
 * Entry-level `autoFlags` reuse the full `evaluateAutoFlagRuleIds` +
 * `FlagContext`, the same convention `lib/analytics/recompute.ts` uses for
 * every other real-event entry, so Match Analytics treats these
 * identically — `sameTeamEntries` is deliberately left empty rather than
 * querying the rest of this team's event history, a scope simplification
 * for live mode (see docs/ASSUMPTIONS.md, P7).
 */
export function resolveLiveAllianceScoring(match: FtcMatch, alliance: AllianceColor, entries: [ScoutEntry, ScoutEntry]): LiveScoringPatch | null {
  const allianceTeams = alliance === "red" ? match.redTeams : match.blueTeams;
  const officialScore = alliance === "red" ? match.redScore : match.blueScore;
  const penaltyPoints = (alliance === "red" ? match.redPenaltyPoints : match.bluePenaltyPoints) ?? 0;
  if (officialScore === null) return null;

  const entryAccuracy = computeAllianceAccuracy(allianceTeams, officialScore, penaltyPoints, entries);
  if (entryAccuracy.status !== "complete") return null;

  const sessionFlags = evaluatePracticeSessionFlags({
    entries,
    mode: null,
    videoProgressAtFinish: null,
    priorCompletedAttempt: false,
  }).map((f) => ({ ...f, dismissed: false }));

  const entryAutoFlags: Record<string, AutoFlag[]> = {};
  for (const entry of entries) {
    const other = entries.find((e) => e.id !== entry.id)!;
    const ctx: FlagContext = {
      match,
      allianceTeams,
      officialAllianceScore: officialScore,
      allianceAccuracy: entryAccuracy,
      sameMatchEntries: [other],
      sameTeamEntries: [],
    };
    const triggeredIds = evaluateAutoFlagRuleIds(entry, ctx);
    const previouslyDismissed = new Set(entry.autoFlags.filter((f) => f.dismissed).map((f) => f.ruleId));
    entryAutoFlags[entry.id] = triggeredIds.map((ruleId) => ({ ruleId, dismissed: previouslyDismissed.has(ruleId) }));
  }

  return {
    sessionAccuracy: entryAccuracy.value !== null ? entryAccuracy.value * 100 : null,
    sessionScoutedTotal: entryAccuracy.scoutedTotal,
    sessionOfficialScore: entryAccuracy.officialScore,
    sessionPenaltyPoints: entryAccuracy.penaltyPoints,
    sessionFlags,
    entryAccuracy,
    entryAutoFlags,
  };
}
