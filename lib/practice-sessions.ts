"use client";

import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchType } from "@/lib/ftc/types";

export type SessionKind = "solo" | "live" | "lobby";
export type SessionStatus = "in-progress" | "paused" | "completed";
export type SessionMode = "trial" | "competitive" | null;
export type AllianceColor = "red" | "blue";
export type Platform = "pc" | "mobile";

export type SessionFlag = {
  type: string;
  title: string;
  detail: string;
  dismissed: boolean;
};

export type PracticeSession = {
  /** The doc id IS the Session ID (see generateSessionId/claimSessionId below). */
  id: string;
  teamId: string;
  uid: string;
  scoutName: string;
  kind: SessionKind;
  seasonId: string;
  mode: SessionMode;
  difficulty: Difficulty | null;
  libraryMatchId: string | null;
  eventCode: string | null;
  alliance: AllianceColor | null;
  robots: number[];
  status: SessionStatus;
  completedRobots: number[];
  entryIds: string[];
  accuracy: number | null;
  scoutedTotal: number | null;
  penaltyPoints: number | null;
  officialScore: number | null;
  platform: Platform;
  flags: SessionFlag[];
  excluded: boolean;
  lobbyId: string | null;
  pairId: string | null;
  startedAt: string;
  finishedAt: string | null;
  /**
   * P7, `kind: "live"` only. Solo identifies its match via `libraryMatchId`
   * alone; a live match may never be in the library at all (`libraryMatchId`
   * stays null then), so live sessions record the real match type/number
   * directly. Also doubles as the `liveMatches/{eventCode_matchKey}`
   * presence doc's own key (`lib/match-library.ts`'s `libraryMatchId()`
   * helper, reused purely for its id-formatting).
   */
  matchType: MatchType | null;
  matchNumber: number | null;
  /** P7, `kind: "live"` only — both teams on `alliance`, so "the other robot" (pending/presence/join logic) never needs a fresh FIRST API roster lookup. `robots` itself stays this session's own single scouted team. */
  allianceTeams: [number, number] | null;
  /** P7, `kind: "live"` only — null for solo/lobby. The pasted livestream link. */
  streamUrl: string | null;
  /** P7: stream position (seconds) when scouting started/ended, when the embed could report it — used to re-watch the match later. Null if not captured (e.g. "Open in a new tab" fallback) or not finished yet. */
  streamStartSec: number | null;
  streamEndSec: number | null;
};

const COLLECTION = "practiceSessions";

const SESSION_ID_PREFIXES: Record<SessionKind, string> = { solo: "PS-", live: "LV-", lobby: "LB-" };
// No 0/O/1/I — unambiguous when read off a screen or written down.
const SESSION_ID_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_ID_SUFFIX_LENGTH = 6;

function randomSuffix(): string {
  let out = "";
  for (let i = 0; i < SESSION_ID_SUFFIX_LENGTH; i++) {
    out += SESSION_ID_ALPHABET[Math.floor(Math.random() * SESSION_ID_ALPHABET.length)];
  }
  return out;
}

/** A readable, random candidate Session ID — PS-/LV-/LB- plus 6 unambiguous characters. Pure; does not check or reserve uniqueness (see claimSessionId). */
export function generateSessionId(kind: SessionKind): string {
  return `${SESSION_ID_PREFIXES[kind]}${randomSuffix()}`;
}

/**
 * Generates a `${prefix}XXXXXX` candidate id and atomically reserves it as
 * a doc in `collectionName`, retrying with a fresh candidate on the rare
 * collision — a bare random-string pick alone can't stop two concurrent
 * callers from both choosing the same free id before either writes
 * anything. Shared by `claimSessionId` (practiceSessions) and `lib/lobby.ts`'s
 * `claimLobbyId` (lobbies, P8) — same scheme, two collections.
 */
export async function claimUniqueDocId(
  collectionName: string,
  prefix: string,
  initialData: Record<string, unknown>,
  maxAttempts = 5
): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `${prefix}${randomSuffix()}`;
    const ref = doc(db, collectionName, candidate);
    const claimed = await runTransaction(db, async (txn) => {
      const snap = await txn.get(ref);
      if (snap.exists()) return false;
      txn.set(ref, initialData);
      return true;
    });
    if (claimed) return candidate;
  }
  throw new Error(`Couldn't generate a unique id in ${collectionName} — try again.`);
}

/**
 * Generates a Session ID and atomically reserves it as a (minimal, valid)
 * `practiceSessions/{id}` doc (see `claimUniqueDocId` above). The caller
 * (P4) follows up with further writes to fill in the rest of the session
 * once more context is known (library match, alliance, robots, ...).
 */
export async function claimSessionId(teamId: string, uid: string, kind: SessionKind, maxAttempts = 5): Promise<string> {
  return claimUniqueDocId(
    COLLECTION,
    SESSION_ID_PREFIXES[kind],
    {
      teamId,
      uid,
      kind,
      status: "in-progress" satisfies SessionStatus,
      startedAt: new Date().toISOString(),
      createdAt: serverTimestamp(),
    },
    maxAttempts
  );
}

function toSession(id: string, data: Record<string, unknown>): PracticeSession {
  return { id, ...data } as PracticeSession;
}

export async function updatePracticeSession(sessionId: string, patch: Partial<PracticeSession>): Promise<void> {
  await updateDoc(doc(db, COLLECTION, sessionId), patch);
}

export async function getPracticeSession(sessionId: string): Promise<PracticeSession | null> {
  const snap = await getDoc(doc(db, COLLECTION, sessionId));
  return snap.exists() ? toSession(snap.id, snap.data()) : null;
}

/** Realtime subscription to one session — for the in-progress scouting screen (P4) or a shared lobby view. */
export function usePracticeSession(sessionId: string | null) {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!sessionId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, COLLECTION, sessionId),
      (snap) => {
        setSession(snap.exists() ? toSession(snap.id, snap.data()) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("practiceSessions/{sessionId} subscription failed:", err);
        setSession(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [sessionId]);

  return { session, loaded };
}

/**
 * Realtime subscription to every `solo` session for the team — what
 * Practice Scouting's Match Select (P4) uses to compute each (match,
 * alliance) row's Fresh/Opened/Scouted status team-wide. Simpler and more
 * robust than querying per `libraryMatchId` (which would hit Firestore's
 * 30-value `in`-query cap for a large library): one subscription, status
 * computed client-side.
 */
export function useTeamPracticeSessions(teamId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId), where("kind", "==", "solo"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => toSession(d.id, d.data())));
        setLoaded(true);
      },
      (err) => {
        console.error("team practiceSessions subscription failed:", err);
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { sessions, loaded };
}

/**
 * Realtime subscription to every `live` session for the team (P7) — what
 * the Pending Robots list and the Presence panel's "is this alliance fully
 * covered" checks read, team-wide (not just the caller's own), same
 * reasoning as `useTeamPracticeSessions`.
 */
export function useTeamLiveSessions(teamId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId), where("kind", "==", "live"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => toSession(d.id, d.data())));
        setLoaded(true);
      },
      (err) => {
        console.error("team live practiceSessions subscription failed:", err);
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { sessions, loaded };
}

/**
 * Realtime, every `practiceSessions` doc for the team regardless of `kind`
 * or `status` (P9) — what the Admin Panel's Sessions/Rescore tabs and Match
 * Analytics' practice view need, since those tools work across solo/live/
 * lobby sessions at once rather than one kind at a time like
 * `useTeamPracticeSessions`/`useTeamLiveSessions` do.
 */
export function useAllTeamPracticeSessions(teamId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, COLLECTION), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => toSession(d.id, d.data())));
        setLoaded(true);
      },
      (err) => {
        console.error("all team practiceSessions subscription failed:", err);
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { sessions, loaded };
}

/** At most one paused session per user (spec) — realtime, so the Resume banner updates if it's resolved from another tab. */
export function useOwnPausedSession(teamId: string | null, uid: string | null) {
  const [session, setSession] = useState<PracticeSession | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !uid || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSession(null);
      setLoaded(true);
      return;
    }
    const q = query(
      collection(db, COLLECTION),
      where("teamId", "==", teamId),
      where("uid", "==", uid),
      where("status", "==", "paused")
    );
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const first = snap.docs[0];
        setSession(first ? toSession(first.id, first.data()) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("own paused practiceSessions subscription failed:", err);
        setSession(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, uid]);

  return { session, loaded };
}

/** One-shot check for the "Repeat Attempt" flag — has this uid already completed this exact alliance+match before? */
export async function hasCompletedAttemptBefore(
  teamId: string,
  uid: string,
  libraryMatchId: string,
  alliance: AllianceColor
): Promise<boolean> {
  const q = query(
    collection(db, COLLECTION),
    where("teamId", "==", teamId),
    where("uid", "==", uid),
    where("libraryMatchId", "==", libraryMatchId),
    where("alliance", "==", alliance),
    where("status", "==", "completed"),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

/**
 * Deletes a session the caller owns while it's still in-progress or
 * paused — backs "Change Match," "Cancel"/"End Session" (discard without
 * saving), and the Resume banner's "Discard" button. Never allowed once
 * completed (see firestore.rules) — P4 extends P3's `allow delete: if
 * false` for exactly this, see docs/ASSUMPTIONS.md.
 */
export async function deletePracticeSession(sessionId: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, sessionId));
}

export type ScoutingCategory = "trial" | "competitive" | "real-event";

type CategoryInput =
  | { source: "event" | "practice" | "live"; mode: SessionMode }
  | { kind: SessionKind; mode: SessionMode };

/** Shared by scoutEntries (source-based) and practiceSessions (kind-based) — a "live" kind/source is always "real-event", matching an in-person or synchronized real competition, never a recorded library match. */
export function getCategory(input: CategoryInput): ScoutingCategory {
  const isRealEvent = "source" in input ? input.source === "event" || input.source === "live" : input.kind === "live";
  if (isRealEvent) return "real-event";
  return input.mode ?? "trial";
}
