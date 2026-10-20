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

export type ScoutEntry = {
  id: string;
  scoutName: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  teamNumber: number;
  fields: ScoutEntryFields;
  score: ScoreBreakdown;
  submittedAt: string;
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

export function saveEntry(input: Omit<ScoutEntry, "id" | "submittedAt">): ScoutEntry {
  const entry: ScoutEntry = {
    ...input,
    id: `se-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    submittedAt: new Date().toISOString(),
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
