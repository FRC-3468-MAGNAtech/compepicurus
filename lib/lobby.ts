"use client";

import {
  collection,
  collectionGroup,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from "firebase/firestore";
import { useEffect, useState } from "react";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { claimUniqueDocId, type PracticeSession, type SessionMode } from "@/lib/practice-sessions";
import { LOBBY_CONFIG } from "@/lib/lobby/config";
import type { PairAssignment } from "@/lib/lobby/pairing";

export type LobbyStatus = "waiting" | "scouting" | "results" | "closed";

export type LobbySettings = {
  /** False = "host opts out of scouting" (host only runs the lobby). */
  hostScouts: boolean;
  /** True = the host's own screen shows the video large; everyone else sees only the form. */
  hostIsDisplayer: boolean;
};

export type LobbyDoc = {
  id: string;
  teamId: string;
  hostUid: string;
  hostName: string;
  seasonId: string;
  mode: Exclude<SessionMode, null>;
  status: LobbyStatus;
  libraryMatchId: string | null;
  settings: LobbySettings;
  /**
   * Set once, at Start — the full pairing for this round. Lives on the
   * lobby doc (not on each player's own subdoc) because only the host may
   * write it and a player can only write their own player doc; see
   * docs/ASSUMPTIONS.md (P8) for why that rules out storing it per-player.
   */
  pairing: PairAssignment[] | null;
  /** ISO — when the countdown ends and video/forms go live for everyone (best-effort synchronized start). */
  startsAt: string | null;
  hostLastSeen: unknown;
  createdAt: unknown;
  resolvedAt: unknown | null;
};

export type LobbyPlayer = {
  uid: string;
  teamId: string;
  name: string;
  joinedAt: unknown;
  lastSeen: unknown;
  submitted: boolean;
};

const LOBBIES = "lobbies";
const PLAYERS = "players";

function toLobby(id: string, data: Record<string, unknown>): LobbyDoc {
  return { id, ...data } as LobbyDoc;
}

/** Generates and reserves a lobby id (also the shareable join code — see docs/ASSUMPTIONS.md, P8) the same way practiceSessions reserves a Session ID. */
export async function claimLobbyId(
  teamId: string,
  hostUid: string,
  hostName: string,
  seasonId: string,
  mode: Exclude<SessionMode, null>
): Promise<string> {
  return claimUniqueDocId("lobbies", "LB-", {
    teamId,
    hostUid,
    hostName,
    seasonId,
    mode,
    status: "waiting" satisfies LobbyStatus,
    libraryMatchId: null,
    settings: { hostScouts: true, hostIsDisplayer: false } satisfies LobbySettings,
    pairing: null,
    startsAt: null,
    hostLastSeen: serverTimestamp(),
    createdAt: serverTimestamp(),
    resolvedAt: null,
  });
}

/** Host-only writes (settings, match selection, pairing, status, heartbeat) — enforced by firestore.rules, not here. */
export async function updateLobby(lobbyId: string, patch: Partial<LobbyDoc>): Promise<void> {
  await updateDoc(doc(db, LOBBIES, lobbyId), patch);
}

export async function heartbeatHost(lobbyId: string): Promise<void> {
  await updateDoc(doc(db, LOBBIES, lobbyId), { hostLastSeen: serverTimestamp() });
}

export function useLobby(lobbyId: string | null) {
  const [lobby, setLobby] = useState<LobbyDoc | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!lobbyId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLobby(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      doc(db, LOBBIES, lobbyId),
      (snap) => {
        setLobby(snap.exists() ? toLobby(snap.id, snap.data()) : null);
        setLoaded(true);
      },
      (err) => {
        console.error("lobbies/{id} subscription failed:", err);
        setLobby(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [lobbyId]);

  return { lobby, loaded };
}

/** Create-or-merge your own player doc — both "Join with code" and a reconnecting refresh call this the same way. */
export async function joinLobby(lobbyId: string, teamId: string, uid: string, name: string): Promise<void> {
  await setDoc(
    doc(db, LOBBIES, lobbyId, PLAYERS, uid),
    { uid, teamId, name, lastSeen: serverTimestamp(), submitted: false, joinedAt: serverTimestamp() },
    { merge: true }
  );
}

export async function heartbeatPlayer(lobbyId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, LOBBIES, lobbyId, PLAYERS, uid), { lastSeen: serverTimestamp() });
}

export async function markPlayerSubmitted(lobbyId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, LOBBIES, lobbyId, PLAYERS, uid), { submitted: true });
}

/** Called by a player's own client on re-entering the waiting room (including after "Play Again") — clears a stale `submitted: true` from the previous round so the next round's "everyone submitted" check isn't satisfied before it even starts. */
export async function resetPlayerSubmitted(lobbyId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, LOBBIES, lobbyId, PLAYERS, uid), { submitted: false });
}

export async function leaveLobbyPlayer(lobbyId: string, uid: string): Promise<void> {
  await deleteDoc(doc(db, LOBBIES, lobbyId, PLAYERS, uid));
}

export function isPlayerActive(lastSeen: unknown): boolean {
  if (!lastSeen || typeof lastSeen !== "object" || !("toMillis" in lastSeen)) return false;
  return Date.now() - (lastSeen as { toMillis: () => number }).toMillis() < LOBBY_CONFIG.PLAYER_STALE_MS;
}

/** Client-derived only — see docs/ASSUMPTIONS.md (P8) for why a stale host never actually flips `status`. */
export function isHostActive(hostLastSeen: unknown): boolean {
  if (!hostLastSeen || typeof hostLastSeen !== "object" || !("toMillis" in hostLastSeen)) return false;
  return Date.now() - (hostLastSeen as { toMillis: () => number }).toMillis() < LOBBY_CONFIG.HOST_STALE_MS;
}

export function useLobbyPlayers(lobbyId: string | null) {
  const [players, setPlayers] = useState<LobbyPlayer[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!lobbyId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPlayers([]);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(
      collection(db, LOBBIES, lobbyId, PLAYERS),
      (snap) => {
        setPlayers(snap.docs.map((d) => d.data() as LobbyPlayer));
        setLoaded(true);
      },
      (err) => {
        console.error("lobbies/{id}/players subscription failed:", err);
        setPlayers([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [lobbyId]);

  return { players, loaded };
}

/**
 * Realtime, every `practiceSessions` doc for this lobby (any player, any
 * status) — the waiting room (to know a player's own session once Start
 * fires, including on reconnect) and the Results screen (per-pair
 * accuracy) both read off this one subscription.
 */
export function useLobbySessions(teamId: string | null, lobbyId: string | null) {
  const [sessions, setSessions] = useState<PracticeSession[]>([]);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !lobbyId || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSessions([]);
      setLoaded(true);
      return;
    }
    const q = query(collection(db, "practiceSessions"), where("teamId", "==", teamId), where("lobbyId", "==", lobbyId));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setSessions(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as PracticeSession));
        setLoaded(true);
      },
      (err) => {
        console.error("lobby practiceSessions subscription failed:", err);
        setSessions([]);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [teamId, lobbyId]);

  return { sessions, loaded };
}

/**
 * Realtime, the most recent lobby this uid still has a player doc in (any
 * status — the caller re-checks `useLobby()`'s own `status` to decide
 * whether to actually show a "rejoin" banner, since a collection-group
 * query here has no cheap way to pre-filter out closed lobbies — see
 * docs/ASSUMPTIONS.md, P8). Needs the `players` collection-group index in
 * firestore.indexes.json.
 */
export function useMyActiveLobbyId(uid: string | null) {
  const [lobbyId, setLobbyId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!uid || !isFirebaseConfigured()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLobbyId(null);
      setLoaded(true);
      return;
    }
    const q = query(collectionGroup(db, PLAYERS), where("uid", "==", uid));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        let best: { id: string; joinedAtMs: number } | null = null;
        for (const d of snap.docs) {
          const data = d.data() as LobbyPlayer;
          const joinedAtMs =
            data.joinedAt && typeof data.joinedAt === "object" && "toMillis" in data.joinedAt
              ? (data.joinedAt as { toMillis: () => number }).toMillis()
              : 0;
          const id = d.ref.parent.parent!.id;
          if (!best || joinedAtMs > best.joinedAtMs) best = { id, joinedAtMs };
        }
        setLobbyId(best?.id ?? null);
        setLoaded(true);
      },
      (err) => {
        console.error("my-active-lobby collectionGroup subscription failed:", err);
        setLobbyId(null);
        setLoaded(true);
      }
    );
    return unsubscribe;
  }, [uid]);

  return { lobbyId, loaded };
}
