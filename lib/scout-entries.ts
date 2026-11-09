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
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { MatchType } from "@/lib/ftc/types";
import type { Form, FormValues, StickyNote } from "@/lib/forms/types";
import { hasLegacyShape, legacyFieldsFromValues } from "@/lib/forms/legacy";
import { storableScore, type ScoreResult } from "@/lib/forms/scoring";
import { commentsFrom, joinNotes } from "@/lib/forms/values";

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

/** The three standard phase subtotals and the total; `byPhase` is only present when some other (custom) phase also scored (P21), so BIOBUZZ entries are unchanged. */
export type ScoreBreakdown = { auto: number; teleop: number; endgame: number; total: number; byPhase?: Record<string, number> };

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
  /** P21: the form (and the immutable version of it) this entry was scouted with, so it can always be read, displayed and rescored against that form. */
  formId: string;
  formVersion: number;
  scoutName: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  teamNumber: number;
  /**
   * P21: the entry's values keyed by the form's field `key`: what every reader should use, through `entryValues()` (lib/forms/legacy.ts), which also
   * reads pre-v2 entries. Absent on entries stored before schema v2.
   */
  values?: FormValues;
  /** Legacy: BIOBUZZ's typed fields object. Present on pre-v2 entries, and still written next to `values` for BIOBUZZ-lineage forms so a rollback or an old tab keeps working. Read through `entryValues()`, not directly. */
  fields?: ScoutEntryFields;
  score: ScoreBreakdown;
  /** P21: present (as `false`) only on entries from a form with scoring off: they have no score, so accuracy and everything that depends on it is "n/a" for them. */
  scored?: false;
  comments: string;
  /** P27: the sticky notes written while filling the form (the panel itself is P28). `comments` is derived from them too, for the old Comments column. */
  stickyNotes?: StickyNote[];
  /** P27: the alliance a form about an alliance (Lead Scout, Match Strategy, Drive Reflection) was filled for; absent on match-scout entries. */
  alliance?: "red" | "blue" | null;
  /** P27: for a plan-versus-actual form: the entry it was prefilled from, and how many answers differed from it when it was submitted. */
  linkedEntryId?: string | null;
  planDifferences?: number;
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

/**
 * P21: everything about an entry that comes from its form: which form and version, the keyed values, the (legacy-shaped) fields for BIOBUZZ
 * lineage forms, the score as it is stored, and the summary comment. Build it with `entryPayloadFor` so every writer stores the same shape.
 */
export type EntryPayload = {
  formId: string;
  formVersion: number;
  values: FormValues;
  fields?: ScoutEntryFields;
  score: ScoreBreakdown;
  scored?: false;
  comments: string;
  stickyNotes?: StickyNote[];
};

/**
 * The summary comment: the form's `comments` field text (if it has one) and the sticky notes' text, joined with " | " (P27). With no notes it is exactly what it
 * always was, so the Comments column and every old entry read the same.
 */
export function derivedComments(form: Pick<Form, "sections">, values: FormValues, stickyNotes?: readonly StickyNote[]): string {
  const base = commentsFrom(form, values);
  const notes = joinNotes(stickyNotes);
  return [base, notes].filter((x) => x.trim() !== "").join(" | ");
}

export function entryPayloadFor(form: Pick<Form, "id" | "version" | "sections" | "scoringEnabled">, values: FormValues, score: ScoreResult, extras: { stickyNotes?: StickyNote[] } = {}): EntryPayload {
  return {
    formId: form.id,
    formVersion: form.version,
    values,
    ...(hasLegacyShape(form) ? { fields: legacyFieldsFromValues(values) as ScoutEntryFields } : {}),
    score: storableScore(score),
    ...(form.scoringEnabled ? {} : { scored: false as const }),
    comments: derivedComments(form, values, extras.stickyNotes),
    ...(extras.stickyNotes && extras.stickyNotes.length > 0 ? { stickyNotes: extras.stickyNotes } : {}),
  };
}

/** Does this entry have a score at all? (False for entries from a form with scoring off: their accuracy is "n/a".) */
export const isScored = (entry: Pick<ScoutEntry, "scored">): boolean => entry.scored !== false;

export type SaveEntryInput = Pick<ScoutEntry, "scoutName" | "eventCode" | "matchType" | "matchNumber" | "teamNumber"> &
  EntryPayload &
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
 * P9: the documented, canonical name for "an analytics page's real-event
 * data" — a plain alias for `getEntriesForEvent`, which already does the
 * actual `source == "event"` filtering (see its own doc comment). Every
 * Analytics page besides Match Analytics still reads from
 * `lib/mock-data.ts` rather than Firestore as of P9, so this has exactly
 * one real caller today (`lib/analytics/recompute.ts`) — see
 * docs/ASSUMPTIONS.md (P9) for why this is a rename-in-waiting, not a
 * multi-page refactor.
 */
export const getEventEntries = getEntriesForEvent;

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

/** P7: both alliance robots' entries for a live match, realtime — live entries for the two robots usually belong to two *different* sessions (sometimes two different scouts), so `getEntriesForSession` (keyed by one session) can't find the sibling; this looks up by the match itself instead. */
export function useEntriesForMatch(teamId: string | null, eventCode: string | null, matchType: ScoutEntry["matchType"] | null, matchNumber: number | null) {
  const [entries, setEntries] = useState<ScoutEntry[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !eventCode || !matchType || matchNumber === null || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setLoaded(true);
      return;
    }
    const q = query(
      collection(db, COLLECTION),
      where("teamId", "==", teamId),
      where("eventCode", "==", eventCode),
      where("matchType", "==", matchType),
      where("matchNumber", "==", matchNumber)
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => toEntry(d.id, d.data())));
        setLoaded(true);
      },
      (err) => {
        console.error("entries-for-match subscription failed:", err);
        setEntries([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, eventCode, matchType, matchNumber]);

  return { entries, loaded };
}

/**
 * P5: every entry for the whole team, every source/mode — what Scout
 * Accuracy/My Scouting's stats engine needs (it covers all three
 * categories at once), unlike `subscribeEntries`'s one-event/"event"-only
 * scope. Team size is small, so one unfiltered-by-category subscription is
 * simpler than three separate ones.
 */
export function useTeamScoutEntries(teamId: string | null) {
  const [entries, setEntries] = useState<ScoutEntry[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setEntries(snap.docs.map((d) => toEntry(d.id, d.data())));
        setLoaded(true);
      },
      (err) => {
        console.error("team scoutEntries subscription failed:", err);
        setEntries([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { entries, loaded };
}

export async function updateEntry(id: string, patch: Partial<ScoutEntry>): Promise<void> {
  await updateDoc(doc(db, COLLECTION, id), patch);
}

export async function deleteEntry(id: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, id));
}
