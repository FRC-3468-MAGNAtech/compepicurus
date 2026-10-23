"use client";

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "@/lib/firebase/client";
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

/** Matches lib/analytics/game-schema.ts's DEFAULT_GAME_ID — the one game/form this season. */
const FORM_ID = "biobuzz";
const FORM_VERSION = 1;

export type ScoutEntry = {
  id: string;
  teamId: string;
  uid: string;
  /** 'event' today; later prompts add 'practice' | 'live'. */
  source: "event";
  mode: null;
  formId: string;
  formVersion: number;
  scoutName: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  teamNumber: number;
  fields: ScoutEntryFields;
  score: ScoreBreakdown;
  comments: string;
  /** Client-set ISO timestamp, usable immediately (including offline, before createdAt syncs). */
  submittedAt: string;
  excluded: boolean;
  autoFlags: AutoFlag[];
  manualFlags: ManualFlag[];
  accuracy: AccuracyResult | null;
};

const COLLECTION = "scoutEntries";

export type SaveEntryInput = Pick<
  ScoutEntry,
  "scoutName" | "eventCode" | "matchType" | "matchNumber" | "teamNumber" | "fields" | "score" | "comments"
>;

export async function saveEntry(teamId: string, uid: string, input: SaveEntryInput): Promise<void> {
  await addDoc(collection(db, COLLECTION), {
    ...input,
    teamId,
    uid,
    source: "event",
    mode: null,
    formId: FORM_ID,
    formVersion: FORM_VERSION,
    submittedAt: new Date().toISOString(),
    createdAt: serverTimestamp(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
  });
}

function toEntry(id: string, data: Record<string, unknown>): ScoutEntry {
  return { id, ...data } as ScoutEntry;
}

export async function getEntries(teamId: string): Promise<ScoutEntry[]> {
  const snap = await getDocs(query(collection(db, COLLECTION), where("teamId", "==", teamId)));
  return snap.docs.map((d) => toEntry(d.id, d.data()));
}

export async function getEntriesForEvent(teamId: string, eventCode: string): Promise<ScoutEntry[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTION), where("teamId", "==", teamId), where("eventCode", "==", eventCode))
  );
  return snap.docs.map((d) => toEntry(d.id, d.data()));
}

/**
 * Realtime subscription for one event's entries. `pendingWrites` counts how
 * many of the returned docs are local writes not yet acknowledged by the
 * server (Firestore tracks this per-document already — no custom bookkeeping
 * needed), which is what drives the "N pending sync" indicator.
 */
export function subscribeEntries(
  teamId: string,
  eventCode: string,
  callback: (entries: ScoutEntry[], pendingWrites: number) => void
): Unsubscribe {
  const q = query(collection(db, COLLECTION), where("teamId", "==", teamId), where("eventCode", "==", eventCode));
  return onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const entries = snap.docs.map((d) => toEntry(d.id, d.data()));
    const pendingWrites = snap.docs.filter((d) => d.metadata.hasPendingWrites).length;
    callback(entries, pendingWrites);
  });
}

export async function updateEntry(id: string, patch: Partial<ScoutEntry>): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), patch);
}

export async function deleteEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
