import type { ScoutEntry } from "@/lib/scout-entries";
import type { MatchType } from "@/lib/ftc/types";

export type ColumnType =
  | "match"
  | "team"
  | "scoutName"
  | "boolean"
  | "count"
  | "score"
  | "comments"
  | "accuracy"
  | "scriptStatus"
  | "actions"
  | "text"
  | "badge";

export type AnalyticsColumn = {
  key: string;
  phase: string;
  category: string;
  label: string;
  type: ColumnType;
  sortable: boolean;
  sticky?: boolean;
  /** px width — used for both rendering and sticky left-offset math. */
  width: number;
  getValue: (entry: ScoutEntry) => unknown;
  /** Only needed when the natural sort order isn't just getValue() itself (e.g. match type+number). */
  getSortValue?: (entry: ScoutEntry) => number | string;
  /** `type: "badge"` only — a Badge-compatible className for this row's value. */
  getBadgeClassName?: (entry: ScoutEntry) => string;
};

export type GameSchema = {
  id: string;
  name: string;
  columns: AnalyticsColumn[];
};

export const MATCH_TYPE_PREFIX: Record<MatchType, string> = {
  Practice: "P",
  Qualification: "Q",
  Playoff: "F",
};

const MATCH_TYPE_ORDER: Record<MatchType, number> = {
  Practice: 0,
  Qualification: 1,
  Playoff: 2,
};

export function formatMatch(entry: Pick<ScoutEntry, "matchType" | "matchNumber">): string {
  return `${MATCH_TYPE_PREFIX[entry.matchType]}${entry.matchNumber}`;
}

export function matchSortValue(entry: Pick<ScoutEntry, "matchType" | "matchNumber">): number {
  return MATCH_TYPE_ORDER[entry.matchType] * 100_000 + entry.matchNumber;
}

const bool = (
  key: string,
  phase: string,
  category: string,
  label: string,
  getValue: (e: ScoutEntry) => boolean
): AnalyticsColumn => ({ key, phase, category, label, type: "boolean", sortable: true, width: 120, getValue });

const count = (
  key: string,
  phase: string,
  category: string,
  label: string,
  getValue: (e: ScoutEntry) => number
): AnalyticsColumn => ({ key, phase, category, label, type: "count", sortable: true, width: 110, getValue });

export const BIOBUZZ_SCHEMA: GameSchema = {
  id: "biobuzz",
  name: "BIOBUZZ",
  columns: [
    {
      key: "match",
      phase: "Information",
      category: "Information",
      label: "Match",
      type: "match",
      sortable: true,
      sticky: true,
      width: 90,
      getValue: formatMatch,
      getSortValue: matchSortValue,
    },
    {
      key: "team",
      phase: "Information",
      category: "Information",
      label: "Team",
      type: "team",
      sortable: true,
      sticky: true,
      width: 90,
      getValue: (e) => e.teamNumber,
    },
    {
      key: "scout",
      phase: "Pre-Match",
      category: "Pre-Match",
      label: "Scout",
      type: "scoutName",
      sortable: true,
      sticky: true,
      width: 150,
      getValue: (e) => e.scoutName,
    },

    bool("autoLeave", "Autonomous", "Leave", "Leave", (e) => e.fields.autoLeave),
    bool("autoPark", "Autonomous", "Park", "Park", (e) => e.fields.autoPark),
    count("autoTipHive", "Autonomous", "Hive", "Tip Hive", (e) => e.fields.autoTipHive),

    count("teleTipHive", "Teleoperated", "Hive", "Tip Hive", (e) => e.fields.teleTipHive),
    bool("flowerBottomNectar", "Teleoperated", "Flower", "Bottom Nectar", (e) => e.fields.flowerBottomNectar),
    count("flowerPollenNectar", "Teleoperated", "Flower", "Pollen and Nectar", (e) => e.fields.flowerPollenNectar),
    count("gardenPollenNectar", "Teleoperated", "Garden", "Pollen and Nectar", (e) => e.fields.gardenPollenNectar),

    bool("endgamePark", "Endgame", "Park", "Park", (e) => e.fields.endgamePark),

    bool("diedDuringMatch", "General", "Incidents", "Died During Match", (e) => e.fields.diedDuringMatch),
    bool("neverStartedMatch", "General", "Incidents", "Never Started Match", (e) => e.fields.neverStartedMatch),
    bool("disabledByFtc", "General", "Incidents", "Disabled by FTC", (e) => e.fields.disabledByFtc),
    bool("recoveredFromFreeze", "General", "Incidents", "Recovered from Freeze", (e) => e.fields.recoveredFromFreeze),
    bool("tippedOver", "General", "Incidents", "Tipped Over", (e) => e.fields.tippedOver),
    bool("yellowCard", "General", "Incidents", "Yellow Card", (e) => e.fields.yellowCard),
    bool("redCard", "General", "Incidents", "Red Card", (e) => e.fields.redCard),

    count("scoreAuto", "General", "Score", "Auto", (e) => e.score.auto),
    count("scoreTeleop", "General", "Score", "Teleop", (e) => e.score.teleop),
    count("scoreEndgame", "General", "Score", "Endgame", (e) => e.score.endgame),
    { ...count("scoreTotal", "General", "Score", "Total", (e) => e.score.total), type: "score" },

    {
      key: "comments",
      phase: "General",
      category: "Comments",
      label: "Comments",
      type: "comments",
      sortable: false,
      width: 260,
      getValue: (e) => e.comments,
    },
    {
      key: "accuracy",
      phase: "General",
      category: "Accuracy Script",
      label: "Alliance Accuracy",
      type: "accuracy",
      sortable: true,
      width: 150,
      getValue: (e) => e.accuracy?.value ?? null,
    },
    {
      key: "scriptStatus",
      phase: "General",
      category: "Script Status",
      label: "Script Status",
      type: "scriptStatus",
      sortable: true,
      width: 140,
      getValue: (e) => e.accuracy?.status ?? "not-applicable",
    },
    {
      key: "actions",
      phase: "Actions",
      category: "Actions",
      label: "Actions",
      type: "actions",
      sortable: false,
      width: 160,
      getValue: () => null,
    },
  ],
};

export const GAMES: Record<string, GameSchema> = {
  biobuzz: BIOBUZZ_SCHEMA,
};

export const DEFAULT_GAME_ID = "biobuzz";

/**
 * P9: Match Analytics' "Practice Scouted Matches" toggle inserts a Session
 * ID column and a source/mode badge right after the sticky Scout column —
 * the real-event schema is never mutated, so the normal (unchecked) view's
 * columns are untouched. `getValue`/`getBadgeClassName` read `source`/`mode`
 * straight off the entry — practice-mode's display entries carry a
 * session-derived `accuracy` by then (see docs/ASSUMPTIONS.md, P9), so the
 * existing "accuracy"/"scriptStatus" columns need no changes at all.
 */
export function withPracticeColumns(schema: GameSchema): GameSchema {
  const sessionIdColumn: AnalyticsColumn = {
    key: "sessionId",
    phase: "Information",
    category: "Information",
    label: "Session ID",
    type: "text",
    sortable: true,
    width: 110,
    getValue: (e) => e.sessionId ?? "—",
  };
  const sourceColumn: AnalyticsColumn = {
    key: "practiceSource",
    phase: "Information",
    category: "Information",
    label: "Source",
    type: "badge",
    sortable: true,
    width: 150,
    getValue: (e) =>
      e.source === "live" ? "Live" : e.mode === "competitive" ? "Practice · Competitive" : e.mode === "trial" ? "Practice · Trial" : "Practice",
    getBadgeClassName: (e) =>
      e.source === "live"
        ? "bg-violet-500/15 text-violet-300 border border-violet-400/30"
        : "bg-sky-500/15 text-sky-300 border border-sky-400/30",
  };
  const insertAt = schema.columns.findIndex((c) => c.key === "scout") + 1;
  const columns = [...schema.columns];
  columns.splice(insertAt, 0, sessionIdColumn, sourceColumn);
  return { ...schema, columns };
}
