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
  | "actions";

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
