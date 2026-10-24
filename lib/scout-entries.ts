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
import { DEFAULT_FORM_ID, FORMS } from "@/lib/scout-form/schema";

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
const FORM_ID = DEFAULT_FORM_ID;
const FORM_VERSION = FORMS[DEFAULT_FORM_ID].version;

/** P3: 'event' (today's Match Scout Form), 'practice' (a solo/lobby session against a library match), 'live' (scouting a real event in real time as a practice session). */
export type ScoutEntrySource = "event" | "practice" | "live";
/** Only meaningful for `source: "practice"` — null for 'event'/'live'. See lib/practice-sessions.ts's getCategory(). */
export type ScoutEntryMode = "trial" | "competitive" | null;

export type ScoutEntry = {
  id: string;
  teamId: string;
  uid: string;
  source: ScoutEntrySource;
  mode: ScoutEntryMode;
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
  /** P3: set for 'practice'/'live' entries — the practiceSessions doc this entry belongs to. */
  sessionId: string | null;
  /** P3: set for 'practice' entries scored against an imported libraryMatches doc. */
  libraryMatchId: string | null;
};

const COLLECTION = "scoutEntries";

export type SaveEntryInput = Pick<
  ScoutEntry,
  "scoutName" | "eventCode" | "matchType" | "matchNumber" | "teamNumber" | "fields" | "score" | "comments"
> &
  Partial<Pick<ScoutEntry, "source" | "mode" | "sessionId" | "libraryMatchId">>;

export async function saveEntry(teamId: string, uid: string, input: SaveEntryInput): Promise<void> {
  const { source = "event", mode = null, sessionId = null, libraryMatchId = null, ...rest } = input;
  await addDoc(collection(db, COLLECTION), {
    ...rest,
    teamId,
    uid,
    source,
    mode,
    sessionId,
    libraryMatchId,
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

/**
 * "event"-sourced entries for one real event only. Explicitly filters
 * `source == "event"` (not just `eventCode`) — P4 introduces `"practice"`
 * entries that can carry the *same* `eventCode` as a real event (a library
 * match imported from an event the team later also scouts live), and
 * without this filter those would silently mix into Match Analytics. See
 * docs/ASSUMPTIONS.md (P4).
 */
export async function getEntriesForEvent(teamId: string, eventCode: string): Promise<ScoutEntry[]> {
  const snap = await getDocs(
    query(
      collection(db, COLLECTION),
      where("teamId", "==", teamId),
      where("eventCode", "==", eventCode),
      where("source", "==", "event")
    )
  );
  return snap.docs.map((d) => toEntry(d.id, d.data()));
}

/**
 * Realtime subscription for one event's "event"-sourced entries only (see
 * getEntriesForEvent's doc comment on the `source` filter). `pendingWrites`
 * counts how many of the returned docs are local writes not yet
 * acknowledged by the server (Firestore tracks this per-document already —
 * no custom bookkeeping needed), which is what drives the "N pending sync"
 * indicator.
 */
export function subscribeEntries(
  teamId: string,
  eventCode: string,
  callback: (entries: ScoutEntry[], pendingWrites: number) => void
): Unsubscribe {
  const q = query(
    collection(db, COLLECTION),
    where("teamId", "==", teamId),
    where("eventCode", "==", eventCode),
    where("source", "==", "event")
  );
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const entries = snap.docs.map((d) => toEntry(d.id, d.data()));
      const pendingWrites = snap.docs.filter((d) => d.metadata.hasPendingWrites).length;
      callback(entries, pendingWrites);
    },
    (err) => console.error("scoutEntries subscription failed:", err)
  );
}

/** P4: every entry saved so far for one practice/live session — used by Results to assemble both robots' entries regardless of whether one was saved earlier (paused, then resumed) or both were saved just now. */
export async function getEntriesForSession(teamId: string, sessionId: string): Promise<ScoutEntry[]> {
  const snap = await getDocs(
    query(collection(db, COLLECTION), where("teamId", "==", teamId), where("sessionId", "==", sessionId))
  );
  return snap.docs.map((d) => toEntry(d.id, d.data()));
}

export async function updateEntry(id: string, patch: Partial<ScoutEntry>): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), patch);
}

export async function deleteEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
