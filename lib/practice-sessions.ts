"use client";

import { doc, getDoc, onSnapshot, runTransaction, serverTimestamp, updateDoc } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { Difficulty } from "@/lib/difficulty";

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
 * Generates a Session ID and atomically reserves it as a (minimal, valid)
 * `practiceSessions/{id}` doc, retrying with a fresh candidate on the rare
 * collision — this is what actually "guarantees uniqueness with a Firestore
 * transaction," since a bare generateSessionId() call alone can't stop two
 * concurrent callers from both picking the same free id before either
 * writes anything. The caller (P4) follows up with further writes to fill
 * in the rest of the session once more context is known (library match,
 * alliance, robots, ...).
 */
export async function claimSessionId(teamId: string, uid: string, kind: SessionKind, maxAttempts = 5): Promise<string> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = generateSessionId(kind);
    const ref = doc(db, COLLECTION, candidate);
    const claimed = await runTransaction(db, async (txn) => {
      const snap = await txn.get(ref);
      if (snap.exists()) return false;
      txn.set(ref, {
        teamId,
        uid,
        kind,
        status: "in-progress" satisfies SessionStatus,
        startedAt: new Date().toISOString(),
        createdAt: serverTimestamp(),
      });
      return true;
    });
    if (claimed) return candidate;
  }
  throw new Error("Couldn't generate a unique session id — try again.");
}

export async function updatePracticeSession(sessionId: string, patch: Partial<PracticeSession>): Promise<void> {
  await updateDoc(doc(db, COLLECTION, sessionId), patch);
}

export async function getPracticeSession(sessionId: string): Promise<PracticeSession | null> {
  const snap = await getDoc(doc(db, COLLECTION, sessionId));
  return snap.exists() ? (snap.data() as PracticeSession) : null;
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
    const unsubscribe = onSnapshot(doc(db, COLLECTION, sessionId), (snap) => {
      setSession(snap.exists() ? (snap.data() as PracticeSession) : null);
      setLoaded(true);
    });
    return unsubscribe;
  }, [sessionId]);

  return { session, loaded };
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
