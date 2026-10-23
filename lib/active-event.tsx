"use client";

// Thin shim over lib/team.ts so every existing consumer (Event Selection,
// Scout Form, Match Analytics) keeps calling useActiveEvent() unchanged —
// the active event now lives on the team doc (realtime, team-wide) instead
// of localStorage. Resolves `teamId` from the signed-in user's own profile
// (lib/team.ts no longer assumes a single fixed team doc — see
// docs/ASSUMPTIONS.md, P1b) so no call site needs to pass one in.
import { useAuth } from "@/lib/auth";
import { setActiveEvent as setTeamActiveEvent, useTeamDoc } from "@/lib/team";
import type { FtcEvent } from "@/lib/ftc/types";

export function useActiveEvent() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { team } = useTeamDoc(teamId);
  const activeEvent = team?.activeEvent ?? null;

  const isActive = (code: string) => activeEvent?.code === code;
  const setActiveEvent = (event: FtcEvent | null) => {
    if (!teamId) return Promise.resolve();
    return setTeamActiveEvent(teamId, event);
  };

  return { activeEvent, setActiveEvent, isActive };
}
