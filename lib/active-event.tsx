"use client";

// Thin shim over lib/team.ts so every existing consumer (Event Selection,
// Scout Form, Match Analytics) keeps calling useActiveEvent() unchanged —
// the active event now lives on the team doc (realtime, team-wide) instead
// of localStorage.
import { setActiveEvent as setTeamActiveEvent, useTeamDoc } from "@/lib/team";

export function useActiveEvent() {
  const { team } = useTeamDoc();
  const activeEvent = team?.activeEvent ?? null;

  const isActive = (code: string) => activeEvent?.code === code;

  return { activeEvent, setActiveEvent: setTeamActiveEvent, isActive };
}
