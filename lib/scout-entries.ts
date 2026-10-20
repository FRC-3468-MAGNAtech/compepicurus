import type { MatchType } from "@/lib/ftc/types";

export type ScoutEntryFields = {
  autoLeave: boolean;
  autoPark: boolean;
  autoTipHive: number;
  teleTipHive: number;
  flowerBottomNectar: boolean;
  flowerPollenNectar: number;
  gardenPollenNectar: number;
  endgamePark: boolean;
  diedDuringMatch: boolean;
  neverStartedMatch: boolean;
  disabledByFtc: boolean;
  recoveredFromFreeze: boolean;
  tippedOver: boolean;
  yellowCard: boolean;
  redCard: boolean;
};

export const initialScoutEntryFields: ScoutEntryFields = {
  autoLeave: false,
  autoPark: false,
  autoTipHive: 0,
  teleTipHive: 0,
  flowerBottomNectar: false,
  flowerPollenNectar: 0,
  gardenPollenNectar: 0,
  endgamePark: false,
  diedDuringMatch: false,
  neverStartedMatch: false,
  disabledByFtc: false,
  recoveredFromFreeze: false,
  tippedOver: false,
  yellowCard: false,
  redCard: false,
};

export type ScoreBreakdown = { auto: number; teleop: number; endgame: number; total: number };

export function computeScore(fields: ScoutEntryFields): ScoreBreakdown {
  const auto = (fields.autoLeave ? 3 : 0) + (fields.autoPark ? 5 : 0) + fields.autoTipHive * 20;
  const teleop =
    fields.teleTipHive * 20 +
    (fields.flowerBottomNectar ? 5 : 0) +
    fields.flowerPollenNectar * 2 +
    fields.gardenPollenNectar * 1;
  const endgame = fields.endgamePark ? 5 : 0;
  return { auto, teleop, endgame, total: auto + teleop + endgame };
}

export type AccuracyStatus = "complete" | "needs-robots" | "awaiting-results" | "not-applicable";

export type AccuracyResult = {
  status: AccuracyStatus;
  value: number | null;
  scoutedTotal: number | null;
  penaltyPoints: number | null;
  officialScore: number | null;
};

export const notApplicableAccuracy: AccuracyResult = {
  status: "not-applicable",
  value: null,
  scoutedTotal: null,
  penaltyPoints: null,
  officialScore: null,
};

export type ManualFlagReason =
  | "No teleop score"
  | "No auto score"
  | "Unrealistic scoring"
  | "Wrong team scouted"
  | "Scout started late"
  | "Scout left early"
  | "Duplicate entry"
  | "Other";

export type AutoFlag = { ruleId: string; dismissed: boolean };
export type ManualFlag = { id: string; reason: ManualFlagReason; note?: string; addedAt: string };

export type ScoutEntry = {
  id: string;
  scoutName: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  teamNumber: number;
  fields: ScoutEntryFields;
  score: ScoreBreakdown;
  comments: string;
  submittedAt: string;
  excluded: boolean;
  autoFlags: AutoFlag[];
  manualFlags: ManualFlag[];
  accuracy: AccuracyResult | null;
};

const STORAGE_KEY = "compepicurus.scout-entries";

let cache: ScoutEntry[] | null = null;

function load(): ScoutEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    cache = raw ? (JSON.parse(raw) as ScoutEntry[]) : [];
  } catch {
    cache = [];
  }
  return cache;
}

function persist(entries: ScoutEntry[]) {
  cache = entries;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // ignore storage failures (e.g. private browsing quota)
  }
}

export function saveEntry(
  input: Omit<ScoutEntry, "id" | "submittedAt" | "excluded" | "autoFlags" | "manualFlags" | "accuracy">
): ScoutEntry {
  const entry: ScoutEntry = {
    ...input,
    id: `se-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    submittedAt: new Date().toISOString(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
  };
  persist([...load(), entry]);
  return entry;
}

export function getEntries(): ScoutEntry[] {
  return load();
}

export function getEntriesForEvent(eventCode: string): ScoutEntry[] {
  return load().filter((e) => e.eventCode === eventCode);
}

export function updateEntry(id: string, patch: Partial<ScoutEntry>): ScoutEntry | null {
  const entries = load();
  const index = entries.findIndex((e) => e.id === id);
  if (index === -1) return null;
  const updated = { ...entries[index], ...patch };
  const next = [...entries];
  next[index] = updated;
  persist(next);
  return updated;
}

export function deleteEntry(id: string): void {
  persist(load().filter((e) => e.id !== id));
}
