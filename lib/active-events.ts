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
  /**
   * FIX4: always the FIRST event's code (the order is the single source of truth: the star means "move to first"),
   * or null only when `events` is empty. Every function below returns a state that holds this.
   */
  primaryCode: string | null;
};

/** The one place the invariant is made: the primary is whatever is first. */
function ordered(events: FtcEvent[]): ActiveEventsState {
  return { events, primaryCode: events[0]?.code ?? null };
}

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

  // FIX4: the primary is first. A team saved before that (primary somewhere in the middle) reads with it moved to the
  // front, the rest keeping their order; the next admin change writes it that way.
  const stored = team.activeEventCode ? events.find((e) => e.code === team.activeEventCode) : undefined;
  return ordered(stored ? [stored, ...events.filter((e) => e.code !== stored.code)] : events);
}

/** True for a team doc that has an active event but predates `activeEventCodes`. */
export function needsActiveEventsMigration(team: TeamActiveEventFields | null | undefined): boolean {
  return !!team && !!team.activeEventCode && team.activeEventCodes === undefined;
}

/** Selects the event (added last) if it isn't selected, removes it if it is. The first selected event is the primary; removing the primary promotes the next one. A selection past `MAX_ACTIVE_EVENTS` is ignored. */
export function toggleActiveEvent(state: ActiveEventsState, event: FtcEvent): ActiveEventsState {
  if (state.events.some((e) => e.code === event.code)) return ordered(state.events.filter((e) => e.code !== event.code));
  if (state.events.length >= MAX_ACTIVE_EVENTS) return state;
  return ordered([...state.events, event]);
}

/**
 * Moves an already-selected event to `toIndex` (clamped), shifting the others. Whatever ends up first is the
 * primary, so moving an event to the front makes it primary and moving the primary down hands it to the next one.
 * An unknown code, or a move that changes nothing, returns `state` itself.
 */
export function moveActiveEvent(state: ActiveEventsState, code: string, toIndex: number): ActiveEventsState {
  const from = state.events.findIndex((e) => e.code === code);
  if (from < 0) return state;
  const to = Math.max(0, Math.min(state.events.length - 1, Math.trunc(toIndex)));
  if (to === from) return state;
  const events = [...state.events];
  const [moved] = events.splice(from, 1);
  events.splice(to, 0, moved);
  return ordered(events);
}

/** The star: "move to first". An unknown code, or the event that already is primary, is a no-op. */
export function setPrimaryActiveEvent(state: ActiveEventsState, code: string): ActiveEventsState {
  return moveActiveEvent(state, code, 0);
}

/** Reorders to `codes` (a drag-and-drop result): codes that aren't selected are ignored, selected ones not listed keep their relative order at the end. */
export function reorderActiveEvents(state: ActiveEventsState, codes: string[]): ActiveEventsState {
  const byCode = new Map(state.events.map((e) => [e.code, e]));
  const seen = new Set<string>();
  const head: FtcEvent[] = [];
  for (const c of codes) {
    const e = byCode.get(c);
    if (e && !seen.has(c)) {
      seen.add(c);
      head.push(e);
    }
  }
  const next = ordered([...head, ...state.events.filter((e) => !seen.has(e.code))]);
  return next.events.every((e, i) => e === state.events[i]) ? state : next;
}

/** Everything written to `teams/{teamId}` for a selection — keeps the legacy single-event fields pointing at the primary so existing readers don't break. */
export function buildActiveEventsFields(state: ActiveEventsState): Required<Pick<TeamActiveEventFields, "activeEventCode" | "activeSeasonId" | "activeEvent" | "activeEventCodes" | "activeEvents">> {
  // FIX4: the primary is the first event, so `activeEventCodes[0] === activeEventCode` always (firestore.rules checks it).
  // A state handed in with its primary elsewhere is written with that event moved to the front.
  const events = orderPrimaryFirst(state);
  const primary = events[0] ?? null;
  return {
    activeEventCode: primary?.code ?? null,
    activeSeasonId: primary?.season ?? null,
    activeEvent: primary,
    activeEventCodes: events.map((e) => e.code),
    activeEvents: events,
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
