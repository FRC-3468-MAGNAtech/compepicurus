"use client";

import { collection, collectionGroup, deleteDoc, doc, onSnapshot, query, serverTimestamp, setDoc, where } from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { libraryMatchId } from "@/lib/match-library";
import { LIVE_CONFIG } from "@/lib/live/config";
import type { MatchType } from "@/lib/ftc/types";
import type { AllianceColor } from "@/lib/practice-sessions";

// P7: who's currently watching/scouting a live match — stored as
// liveMatches SLASH eventCode-and-matchKey SLASH scouts SLASH uid. The
// parent liveMatches doc itself is never written (no fields of its own
// needed yet); only the scouts subcollection exists. Not teamId-scoped at
// the match-key level (same reasoning as libraryMatches — a real match is
// the same match regardless of which team is watching), but every scout
// presence doc carries its own teamId so one team's "who's covering this
// alliance" bookkeeping never sees another team's scouts — see
// docs/ASSUMPTIONS.md (P7).
export type LiveMatchScoutPresence = {
  uid: string;
  teamId: string;
  name: string;
  robot: number;
  alliance: AllianceColor;
  sessionId: string;
  lastSeen: unknown;
};

const COLLECTION = "liveMatches";

/** Reuses `lib/match-library.ts`'s id format purely for consistency — `liveMatches` and `libraryMatches` key the same real match identically. */
export function liveMatchKey(eventCode: string, matchType: MatchType, matchNumber: number): string {
  return libraryMatchId(eventCode, matchType, matchNumber);
}

export async function upsertPresence(matchKey: string, presence: Omit<LiveMatchScoutPresence, "lastSeen">): Promise<void> {
  await setDoc(doc(db, COLLECTION, matchKey, "scouts", presence.uid), { ...presence, lastSeen: serverTimestamp() });
}

export async function removePresence(matchKey: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, COLLECTION, matchKey, "scouts", uid));
}

export function isPresenceActive(lastSeen: unknown): boolean {
  if (!lastSeen || typeof lastSeen !== "object" || !("toMillis" in lastSeen)) return false;
  const ms = (lastSeen as { toMillis: () => number }).toMillis();
  return Date.now() - ms < LIVE_CONFIG.PRESENCE_STALE_MS;
}

/** Realtime, one match's presence list (any team — the caller filters by `teamId` itself, since a real match's presence is shared viewing). */
export function useLiveMatchScouts(matchKey: string | null) {
  const [scouts, setScouts] = useState<LiveMatchScoutPresence[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!matchKey || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScouts([]);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      collection(db, COLLECTION, matchKey, "scouts"),
      (snap) => {
        setScouts(snap.docs.map((d) => d.data() as LiveMatchScoutPresence));
        setLoaded(true);
      },
      (err) => {
        console.error("liveMatches scouts subscription failed:", err);
        setScouts([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [matchKey]);

  return { scouts, loaded };
}

/** Realtime, every one of this team's scouts actively watching any live match right now (a collection-group query across every match's `scouts` subcollection) — what the Practice Scouting landing panel and the top-nav pill scan for "exactly one active scout on some match." */
export function useTeamActiveLiveScouts(teamId: string | null) {
  const [scouts, setScouts] = useState<(LiveMatchScoutPresence & { matchKey: string })[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setScouts([]);
      setLoaded(true);
      return;
    }
    const q = query(collectionGroup(db, "scouts"), where("teamId", "==", teamId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const all = snap.docs.map((d) => ({ ...(d.data() as LiveMatchScoutPresence), matchKey: d.ref.parent.parent!.id }));
        setScouts(all.filter((s) => isPresenceActive(s.lastSeen)));
        setLoaded(true);
      },
      (err) => {
        console.error("team active live scouts subscription failed:", err);
        setScouts([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId]);

  return { scouts, loaded };
}
