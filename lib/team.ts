"use client";

import { useEffect, useState } from "react";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import type { FtcEvent } from "@/lib/ftc/types";

export type TeamDoc = {
  number: number;
  name: string | null;
  joinCode: string;
  activeEventCode: string | null;
  activeSeasonId: number | null;
  // Denormalized copy of the active event's own details, so every page
  // reading "what's the active event" doesn't need a second FIRST API round
  // trip just to show its name/dates — refreshed whenever an admin sets a
  // new one (see setActiveEvent below).
  activeEvent: FtcEvent | null;
};

/**
 * Realtime subscription to the *caller's own* team doc — `teamId` comes
 * from their profile (`useAuth().profile?.teamId`), not a fixed id (see
 * docs/ASSUMPTIONS.md, P1b: team docs now get an auto-generated id, created
 * via /api/team/create, since more than one can exist). Pass `null` while
 * the caller's profile hasn't loaded yet, or isn't on a team at all.
 */
export function useTeamDoc(teamId: string | null) {
  const [team, setTeam] = useState<TeamDoc | null>(null);
  // isFirebaseConfigured() is a pure, static check — folding it into the
  // initializer (rather than setting it from inside the effect below) means
  // the "not configured" case never needs a synchronous setState in an effect.
  const [loaded, setLoaded] = useState(() => !isFirebaseConfigured());

  useEffect(() => {
    if (!teamId || !isFirebaseConfigured()) {
      // Deliberate: resets to "no team" whenever teamId becomes unavailable
      // (profile not loaded yet, or this user isn't on a team), rather than
      // leaving a previous team's data on screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTeam(null);
      setLoaded(true);
      return;
    }
    const unsubscribe = onSnapshot(doc(db, "teams", teamId), (snap) => {
      setTeam(snap.exists() ? (snap.data() as TeamDoc) : null);
      setLoaded(true);
    });
    return unsubscribe;
  }, [teamId]);

  return { team, loaded };
}

/** Admin-gated at the call site (Event Selection page) via usePermissions(); also enforced in firestore.rules. */
export async function setActiveEvent(teamId: string, event: FtcEvent | null) {
  await updateDoc(doc(db, "teams", teamId), {
    activeEventCode: event?.code ?? null,
    activeSeasonId: event?.season ?? null,
    activeEvent: event ?? null,
  });
}
