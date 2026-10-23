"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import { TEAM_ID } from "@/lib/auth";
import type { FtcEvent } from "@/lib/ftc/types";

export type TeamDoc = {
  number: number;
  joinCode: string;
  activeEventCode: string | null;
  activeSeasonId: number | null;
  /** True once the first admin's user doc has been created — see firestore.rules and lib/auth.tsx's firstRunSetup. */
  firstAdminClaimed: boolean;
  // Denormalized copy of the active event's own details, so every page
  // reading "what's the active event" doesn't need a second FIRST API round
  // trip just to show its name/dates — refreshed whenever an admin sets a
  // new one (see setActiveEvent below).
  activeEvent: FtcEvent | null;
};

/**
 * Realtime subscription to the one team doc. `exists === false` is the
 * first-run signal (show the setup screen); `exists === null` means we
 * haven't heard back yet.
 */
export function useTeamDoc() {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  // isFirebaseConfigured() is a pure, static check — folding it into the
  // initializer (rather than setting it from inside the effect below) means
  // the "not configured" case never needs a synchronous setState in an effect.
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());
  const [exists, setExists] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isFirebaseConfigured()) return;
    const unsubscribe = onSnapshot(doc(db, "teams", TEAM_ID), (snap) => {
      setExists(snap.exists());
      setTeam(snap.exists() ? (snap.data() as TeamDoc) : null);
      setLoaded(true);
    });
    return unsubscribe;
  }, []);

  return { team, loaded, exists };
}

/** Admin-gated at the call site (Event Selection page) via usePermissions(); also enforced in firestore.rules. */
export async function setActiveEvent(event: FtcEvent | null) {
  await updateDoc(doc(db, "teams", TEAM_ID), {
    activeEventCode: event?.code ?? null,
    activeSeasonId: event?.season ?? null,
    activeEvent: event ?? null,
  });
}
