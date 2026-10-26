import type { MatchType } from "@/lib/ftc/types";

export type SlotId = "red1" | "red2" | "blue1" | "blue2";

export const SLOT_IDS: SlotId[] = ["red1", "red2", "blue1", "blue2"];

/**
 * One match's teams, generic across match sources (event schedule, practice
 * library, live). An alliance is `null` when it's excluded for this source
 * (e.g. a practice-library alliance whose own difficulty doesn't match the
 * difficulty the admin picked) — its two slots are simply never generated.
 */
export type MatchInput = {
  matchType: MatchType;
  matchNumber: number;
  red: [number, number] | null;
  blue: [number, number] | null;
};

export type RotationPattern = "rotate-each-match" | "custom-interval" | "constant-same-order";

export type ScheduleSettings = {
  /** The selected scout pool — order doesn't matter, the scheduler shuffles. */
  scoutUids: string[];
  pattern: RotationPattern;
  /** Only read for `"custom-interval"`. Defaults to 4. */
  intervalSize?: number;
  /**
   * When set (non-empty), ONLY these teams' slots are ever assigned — every
   * other slot in every match is left `scoutUid: null` outright, not
   * "filled if there's capacity." This is what frees up enough slack for
   * breaks when there are only ~4-6 scouts total — see
   * docs/ASSUMPTIONS.md (P6).
   */
  prioritizedTeams?: number[];
  seed: number;
};

export type ScheduleSlot = {
  matchType: MatchType;
  matchNumber: number;
  slot: SlotId;
  teamNumber: number;
  scoutUid: string | null;
};

export type ScheduleResult = {
  slots: ScheduleSlot[];
  /** Every selected scout's total assigned-slot count, even if 0. */
  counts: Record<string, number>;
  /** `max(counts) - min(counts) <= 1`, the fairness target. */
  fair: boolean;
  /** Set whenever `fair` is false, or there were no scouts/matches to schedule — human-readable, shown as-is in the UI. */
  warning: string | null;
};
