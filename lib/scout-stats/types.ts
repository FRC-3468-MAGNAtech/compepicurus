import type { AccuracyStatusInfo } from "@/lib/accuracy/engine";
import type { RoleId } from "@/lib/roles";

export type ScoutCategory = "trial" | "competitive" | "real-event";

/**
 * How the rank *number* is computed — independent of which rows are
 * visible (that's the role/event filters). "preserve" ranks every team
 * member regardless of any active filter, so a visible scout keeps their
 * true team-wide rank even when the table is narrowed down; the other
 * three re-rank within just the role filter's matches, just the event
 * filter's matches, or their intersection. See docs/ASSUMPTIONS.md (P5).
 */
export type RankingBasisId = "preserve" | "role" | "event" | "both";

export type RealEventCalculationScope = {
  /** null = "All Events". */
  eventCode: string | null;
  variant: "plain" | "trial" | "competitive";
};

export type SessionFlagSummary = { type: string; title: string; detail: string };

export type PracticeSessionSummary = {
  sessionId: string;
  matchLabel: string;
  /** ISO, `finishedAt`. */
  date: string | null;
  /** 0-100. */
  accuracy: number | null;
  platform: "pc" | "mobile";
  activeFlags: SessionFlagSummary[];
  excluded: boolean;
};

export type RealEventEntrySummary = {
  entryId: string;
  matchLabel: string;
  /** 0-100. */
  accuracy: number | null;
  activeAutoFlagTitles: string[];
  manualFlagReasons: string[];
  excluded: boolean;
};

export type ScoutCategoryDetail = {
  uid: string;
  name: string;
  /** 0-100. */
  averageAccuracy: number | null;
  status: AccuracyStatusInfo | null;
  /** Sessions completed (practice categories) or forms completed (Real Event). */
  sessionsOrForms: number;
  /** Practice categories only — null for Real Event (forms completed already equals entries). */
  totalEntries: number | null;
  /** ISO. */
  lastScoutedAt: string | null;
  /** Most-recent-first. Empty outside practice categories. */
  recentPracticeSessions: PracticeSessionSummary[];
  /** Most-recent-first. Empty outside Real Event. */
  recentRealEntries: RealEventEntrySummary[];
};

export type ScoutLeaderboardRow = {
  uid: string;
  name: string;
  primaryRole: RoleId;
  secondaryRoles: RoleId[];
  /** 0-100, or null to display "?". */
  accuracy: number | null;
  status: AccuracyStatusInfo | null;
  sessionsOrForms: number;
  totalEntries: number | null;
  rank: number | null;
};

export type ScoutStatsSummary = {
  membersWithData: number;
  totalMembers: number;
  /** 0-100, mean of the currently-shown scouts' accuracy. */
  averageAccuracy: number | null;
  sessionsOrFormsCompleted: number;
  /** Null for Real Event. */
  totalEntries: number | null;
};

export type ScoutStatsResult = {
  rows: ScoutLeaderboardRow[];
  summary: ScoutStatsSummary;
  detailsByUid: Map<string, ScoutCategoryDetail>;
};
