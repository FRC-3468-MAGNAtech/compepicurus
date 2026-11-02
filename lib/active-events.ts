import { getEventStatus } from "@/lib/ftc/event-status";
import type { FtcEvent } from "@/lib/ftc/types";

// Pure helpers behind the team's *several* active events (FIX1-2b). Kept free
// of React/Firebase imports so they're unit-testable; the realtime hook is
// `useActiveEvents()` in lib/active-event.tsx and the Firestore write is
// `setActiveEvents()` in lib/team.ts.

/** Sensible ceiling — also enforced in firestore.rules. */
export const MAX_ACTIVE_EVENTS = 10;

/** The active-event fields of `teams/{teamId}`, all optional so pre-FIX1 team docs (single `activeEvent`) still type-check. */
export type TeamActiveEventFields = {
  activeEventCode?: string | null;
  activeSeasonId?: number | null;
  activeEvent?: FtcEvent | null;
  activeEventCodes?: string[];
  activeEvents?: FtcEvent[];
};

export type ActiveEventsState = {
  events: FtcEvent[];
  /** Always one of `events`' codes, or null only when `events` is empty. */
  primaryCode: string | null;
};

/**
 * Reads the active events off a team doc. Teams created before FIX1 only have
 * `activeEventCode`/`activeEvent`, so those read as a one-event list — correct
 * without anyone having to write a migration first (an admin's session also
 * persists it; see `useActiveEvents`).
 */
export function readActiveEvents(team: TeamActiveEventFields | null | undefined): ActiveEventsState {
  if (!team) return { events: [], primaryCode: null };

  const source = team.activeEvents && team.activeEvents.length > 0 ? team.activeEvents : team.activeEvent ? [team.activeEvent] : [];
  const seen = new Set<string>();
  const events = source.filter((e) => {
    if (seen.has(e.code)) return false;
    seen.add(e.code);
    return true;
  });

  const primaryCode =
    team.activeEventCode && events.some((e) => e.code === team.activeEventCode) ? team.activeEventCode : (events[0]?.code ?? null);
  return { events, primaryCode };
}

/** True for a team doc that has an active event but predates `activeEventCodes`. */
export function needsActiveEventsMigration(team: TeamActiveEventFields | null | undefined): boolean {
  return !!team && !!team.activeEventCode && team.activeEventCodes === undefined;
}

/** Selects the event if it isn't selected, removes it if it is. The first selected event becomes primary; removing the primary promotes the next one. A selection past `MAX_ACTIVE_EVENTS` is ignored. */
export function toggleActiveEvent(state: ActiveEventsState, event: FtcEvent): ActiveEventsState {
  if (state.events.some((e) => e.code === event.code)) {
    const events = state.events.filter((e) => e.code !== event.code);
    const primaryCode = state.primaryCode === event.code ? (events[0]?.code ?? null) : state.primaryCode;
    return { events, primaryCode };
  }
  if (state.events.length >= MAX_ACTIVE_EVENTS) return state;
  return { events: [...state.events, event], primaryCode: state.primaryCode ?? event.code };
}

/** Marks an already-selected event as primary; anything else is a no-op. */
export function setPrimaryActiveEvent(state: ActiveEventsState, code: string): ActiveEventsState {
  if (!state.events.some((e) => e.code === code)) return state;
  return { ...state, primaryCode: code };
}

/** Everything written to `teams/{teamId}` for a selection — keeps the legacy single-event fields pointing at the primary so existing readers don't break. */
export function buildActiveEventsFields(state: ActiveEventsState): Required<Pick<TeamActiveEventFields, "activeEventCode" | "activeSeasonId" | "activeEvent" | "activeEventCodes" | "activeEvents">> {
  const primary = state.events.find((e) => e.code === state.primaryCode) ?? state.events[0] ?? null;
  return {
    activeEventCode: primary?.code ?? null,
    activeSeasonId: primary?.season ?? null,
    activeEvent: primary,
    activeEventCodes: state.events.map((e) => e.code),
    activeEvents: state.events,
  };
}

/** The primary event first, the rest in selection order — what pickers and filters list first. */
export function orderPrimaryFirst(state: ActiveEventsState): FtcEvent[] {
  const primary = state.events.find((e) => e.code === state.primaryCode);
  return primary ? [primary, ...state.events.filter((e) => e.code !== primary.code)] : state.events;
}

/** Default for pickers: an In Progress active event (the primary if it's one), otherwise the primary. Null when nothing is active. */
export function pickDefaultActiveEvent(state: ActiveEventsState, now: Date | number = new Date()): FtcEvent | null {
  const ordered = orderPrimaryFirst(state);
  return ordered.find((e) => getEventStatus(e, now) === "in-progress") ?? ordered[0] ?? null;
}
