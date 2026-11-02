"use client";

// Thin shims over lib/team.ts + lib/active-events.ts. The team's active
// events live on the team doc (realtime, team-wide), not localStorage.
// Resolves `teamId` from the signed-in user's own profile (lib/team.ts no
// longer assumes a single fixed team doc — see docs/ASSUMPTIONS.md, P1b) so
// no call site needs to pass one in.
import { useCallback, useEffect, useMemo } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { db } from "@/lib/firebase/client";
import { setActiveEvent as setTeamActiveEvent, useTeamDoc } from "@/lib/team";
import {
  buildActiveEventsFields,
  needsActiveEventsMigration,
  readActiveEvents,
} from "@/lib/active-events";
import type { FtcEvent } from "@/lib/ftc/types";

// Teams that predate FIX1 are migrated (`activeEventCodes = [activeEventCode]`)
// the first time an admin's session sees them. Module-level so the dozens of
// components calling this hook don't each fire the same write.
const migrationsAttempted = new Set<string>();

/**
 * FIX1: every active event, the primary one, and an `isActive(code)` check —
 * realtime, shared by every page that used to assume exactly one active event.
 * `events` is in selection order; `primary` is the event the legacy
 * `teams/{id}.activeEventCode` points at (null when nothing is active).
 */
export function useActiveEvents() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const isAdmin = profile?.isAdmin ?? false;
  const { team, loaded } = useTeamDoc(teamId);

  const state = useMemo(() => readActiveEvents(team), [team]);
  const primary = useMemo(() => state.events.find((e) => e.code === state.primaryCode) ?? null, [state]);

  useEffect(() => {
    if (!teamId || !isAdmin || !needsActiveEventsMigration(team) || migrationsAttempted.has(teamId)) return;
    migrationsAttempted.add(teamId);
    // Best-effort and idempotent: if it fails, reads still derive the same
    // one-event list from the legacy fields, so nothing depends on it landing.
    updateDoc(doc(db, "teams", teamId), buildActiveEventsFields(state)).catch((err) => {
      migrationsAttempted.delete(teamId);
      console.error("active events migration failed:", err);
    });
  }, [teamId, isAdmin, team, state]);

  const isActive = useCallback((code: string) => state.events.some((e) => e.code === code), [state.events]);

  return { events: state.events, primary, primaryCode: state.primaryCode, isActive, loaded };
}

/** The primary active event only — kept for callers that genuinely only need one. Anything that picks or filters by event should use `useActiveEvents()`. */
export function useActiveEvent() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { primary, isActive } = useActiveEvents();

  const setActiveEvent = (event: FtcEvent | null) => {
    if (!teamId) return Promise.resolve();
    return setTeamActiveEvent(teamId, event);
  };

  return { activeEvent: primary, setActiveEvent, isActive };
}
