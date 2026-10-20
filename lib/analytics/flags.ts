import type { FtcMatch } from "@/lib/ftc/types";
import type { AccuracyResult, ScoutEntry } from "@/lib/scout-entries";

/**
 * All automatic-flagging thresholds in one place, per the spec. Every value
 * here is a placeholder — tune against real BIOBUZZ match data once there's
 * enough of it to see what "normal" actually looks like.
 */
export const FLAG_THRESHOLDS = {
  UNREALISTIC_AUTO_TIP_HIVE: 3,
  UNREALISTIC_TELEOP_TIP_HIVE: 6,
  UNREALISTIC_TELEOP_FLOWER_POLLEN: 20,
  UNREALISTIC_TELEOP_GARDEN_POLLEN: 40,
  PLAUSIBLE_SINGLE_ROBOT_MAX_SCORE: 200,
  /** Heuristic for "a full scoring run" when paired with Disabled by FTC. */
  CONTRADICTORY_DISABLED_SCORE_MIN: 100,
  OUTLIER_STD_DEV_THRESHOLD: 3,
  OUTLIER_MIN_OTHER_ENTRIES: 4,
  LOW_ALLIANCE_ACCURACY_THRESHOLD: 0.5,
};

export type FlagContext = {
  /** Official match data, or null if it couldn't be loaded/found. */
  match: FtcMatch | null;
  /** This entry's alliance roster on that match ([] if the team isn't on it). */
  allianceTeams: number[];
  officialAllianceScore: number | null;
  allianceAccuracy: AccuracyResult | null;
  /** Other non-excluded entries for this exact match (any team), excluding this entry. */
  sameMatchEntries: ScoutEntry[];
  /** Other non-excluded entries for this team within the event, excluding this entry. */
  sameTeamEntries: ScoutEntry[];
};

export type FlagRule = {
  id: string;
  title: string;
  explanation: string;
  evaluate: (entry: ScoutEntry, ctx: FlagContext) => boolean;
};

const T = FLAG_THRESHOLDS;

export const FLAG_RULES: FlagRule[] = [
  {
    id: "zero-main-scoring",
    title: "Zero Main Scoring",
    explanation: "No auto/teleop/endgame scoring recorded.",
    evaluate: (e) => !e.fields.neverStartedMatch && !e.fields.diedDuringMatch && e.score.total === 0,
  },
  {
    id: "unrealistic-auto-scoring",
    title: "Unrealistic Auto Scoring",
    explanation: `Auto Tip Hive count is above ${T.UNREALISTIC_AUTO_TIP_HIVE}.`,
    evaluate: (e) => e.fields.autoTipHive > T.UNREALISTIC_AUTO_TIP_HIVE,
  },
  {
    id: "unrealistic-teleop-scoring",
    title: "Unrealistic Teleop Scoring",
    explanation: "A teleop counter or the total score is above a plausible single-robot amount.",
    evaluate: (e) =>
      e.fields.teleTipHive > T.UNREALISTIC_TELEOP_TIP_HIVE ||
      e.fields.flowerPollenNectar > T.UNREALISTIC_TELEOP_FLOWER_POLLEN ||
      e.fields.gardenPollenNectar > T.UNREALISTIC_TELEOP_GARDEN_POLLEN ||
      e.score.total > T.PLAUSIBLE_SINGLE_ROBOT_MAX_SCORE,
  },
  {
    id: "exceeds-alliance-score",
    title: "Exceeds Alliance Score",
    explanation: "This robot's calculated score is higher than its alliance's official score for the match.",
    evaluate: (e, ctx) => ctx.officialAllianceScore !== null && e.score.total > ctx.officialAllianceScore,
  },
  {
    id: "never-started-but-scored",
    title: "Never Started But Scored",
    explanation: "Never Started Match is checked but points were recorded.",
    evaluate: (e) => e.fields.neverStartedMatch && e.score.total > 0,
  },
  {
    id: "contradictory-incidents",
    title: "Contradictory Incidents",
    explanation: "The checked incidents don't make sense together (e.g. never started but recovered from freeze).",
    evaluate: (e) =>
      (e.fields.neverStartedMatch && e.fields.recoveredFromFreeze) ||
      (e.fields.disabledByFtc && e.score.total >= T.CONTRADICTORY_DISABLED_SCORE_MIN),
  },
  {
    id: "team-not-in-match",
    title: "Team Not In Match",
    explanation: "This team isn't one of the four teams on the match's official schedule.",
    evaluate: (e, ctx) => ctx.match !== null && ctx.allianceTeams.length === 0,
  },
  {
    id: "scout-logged-multiple-robots",
    title: "Scout Logged Multiple Robots",
    explanation: "This scout submitted entries for more than one robot in this match.",
    evaluate: (e, ctx) => ctx.sameMatchEntries.some((o) => o.scoutName === e.scoutName && o.teamNumber !== e.teamNumber),
  },
  {
    id: "duplicate-entry",
    title: "Duplicate Entry",
    explanation: "More than one entry exists for this team in this match — the most recent is used for accuracy.",
    evaluate: (e, ctx) => ctx.sameMatchEntries.some((o) => o.teamNumber === e.teamNumber),
  },
  {
    id: "statistical-outlier",
    title: "Statistical Outlier",
    explanation: `This entry's total is more than ${T.OUTLIER_STD_DEV_THRESHOLD} standard deviations from this team's own average.`,
    evaluate: (e, ctx) => {
      if (ctx.sameTeamEntries.length < T.OUTLIER_MIN_OTHER_ENTRIES) return false;
      const totals = ctx.sameTeamEntries.map((o) => o.score.total);
      const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
      const variance = totals.reduce((a, b) => a + (b - mean) ** 2, 0) / totals.length;
      const stdDev = Math.sqrt(variance);
      return stdDev > 0 && Math.abs(e.score.total - mean) > T.OUTLIER_STD_DEV_THRESHOLD * stdDev;
    },
  },
  {
    id: "low-alliance-accuracy",
    title: "Low Alliance Accuracy",
    explanation: `This match's alliance accuracy is below ${Math.round(T.LOW_ALLIANCE_ACCURACY_THRESHOLD * 100)}%.`,
    evaluate: (e, ctx) =>
      ctx.allianceAccuracy?.status === "complete" && (ctx.allianceAccuracy.value ?? 1) < T.LOW_ALLIANCE_ACCURACY_THRESHOLD,
  },
];

export const FLAG_RULES_BY_ID: Record<string, FlagRule> = Object.fromEntries(FLAG_RULES.map((r) => [r.id, r]));

export function evaluateAutoFlagRuleIds(entry: ScoutEntry, ctx: FlagContext): string[] {
  return FLAG_RULES.filter((rule) => rule.evaluate(entry, ctx)).map((rule) => rule.id);
}
