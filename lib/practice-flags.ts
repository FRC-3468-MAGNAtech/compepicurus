import { evaluateAutoFlagRuleIds, type FlagContext } from "@/lib/analytics/flags";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { SessionFlag, SessionMode } from "@/lib/practice-sessions";

/** All practice-session flag thresholds in one place, per the spec. */
export const PRACTICE_FLAG_THRESHOLDS = {
  /** Competitive session finished before this share (0-1) of the video had played. Placeholder, per the prompt. */
  FINISHED_EARLY_MIN_PROGRESS: 0.8,
};

// Only these two of Match Analytics' 11 auto-flag rules are "Unrealistic
// Entry" here — the rest (duplicate-entry, team-not-in-match,
// exceeds-alliance-score, ...) either don't apply to an isolated practice
// session or are redundant with the Results screen's own accuracy display.
const UNREALISTIC_SCORING_RULE_IDS = new Set(["unrealistic-auto-scoring", "unrealistic-teleop-scoring"]);

const EMPTY_FLAG_CONTEXT: FlagContext = {
  match: null,
  allianceTeams: [],
  officialAllianceScore: null,
  allianceAccuracy: null,
  sameMatchEntries: [],
  sameTeamEntries: [],
};

function tripsUnrealisticScoringRule(entry: ScoutEntry): boolean {
  return evaluateAutoFlagRuleIds(entry, EMPTY_FLAG_CONTEXT).some((id) => UNREALISTIC_SCORING_RULE_IDS.has(id));
}

export type PracticeFlagInput = {
  entries: [ScoutEntry, ScoutEntry];
  mode: SessionMode;
  /** 0-1, how much of the video had played when the session finished — null if unknown/not applicable (e.g. Trial, where this flag never applies). */
  videoProgressAtFinish: number | null;
  /** Did this uid already complete this same alliance+match before this attempt? */
  priorCompletedAttempt: boolean;
};

export type PendingSessionFlag = Omit<SessionFlag, "dismissed">;

/**
 * The four automatic session flags from the spec. Returns flags with
 * `dismissed` omitted — the caller (Results screen save) sets `dismissed:
 * false` on each before writing, since that's a storage concern, not an
 * evaluation one.
 */
export function evaluatePracticeSessionFlags(input: PracticeFlagInput): PendingSessionFlag[] {
  const flags: PendingSessionFlag[] = [];
  const [first, second] = input.entries;

  if (first.score.total === 0 && second.score.total === 0) {
    flags.push({
      type: "zero-entries",
      title: "Zero Entries",
      detail: "Both entries have all-zero scoring.",
    });
  }

  if (tripsUnrealisticScoringRule(first) || tripsUnrealisticScoringRule(second)) {
    flags.push({
      type: "unrealistic-entry",
      title: "Unrealistic Entry",
      detail: "At least one entry recorded scoring well above what's plausible for a single robot.",
    });
  }

  if (
    input.mode === "competitive" &&
    input.videoProgressAtFinish !== null &&
    input.videoProgressAtFinish < PRACTICE_FLAG_THRESHOLDS.FINISHED_EARLY_MIN_PROGRESS
  ) {
    flags.push({
      type: "finished-early",
      title: "Finished Early",
      detail: `Finished before ${Math.round(PRACTICE_FLAG_THRESHOLDS.FINISHED_EARLY_MIN_PROGRESS * 100)}% of the video had played.`,
    });
  }

  if (input.priorCompletedAttempt) {
    flags.push({
      type: "repeat-attempt",
      title: "Repeat Attempt",
      detail: "You've already completed this alliance on this match before.",
    });
  }

  return flags;
}
