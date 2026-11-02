import type { EventLifecycleStatus, FtcEvent } from "./types";

// Deliberately not "use server"/"use client" and free of any API/Firebase
// imports: this is the one place an event's lifecycle status is derived, used
// by the server action that builds `FtcEvent.status` (lib/ftc/actions.ts) and
// by every client page that needs a *fresh* status (Event Selection, the
// active-events hook) — `FtcEvent.status` is frozen at fetch time, so an event
// stored on the team doc days ago would otherwise still read "upcoming".

export type EventStatusInput = Pick<FtcEvent, "dateStart" | "dateEnd"> & { timezone?: string | null };

/** Calendar date (YYYY-MM-DD) of `now` in the event's own timezone, falling back to the viewer's local timezone. */
function calendarDay(now: Date, timeZone?: string | null): string {
  if (timeZone) {
    try {
      // en-CA formats as YYYY-MM-DD.
      return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
    } catch {
      // Unknown timezone id — fall through to local time.
    }
  }
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * **Upcoming** — starts after today; **In Progress** — today falls between
 * the start and end dates (both inclusive); **Completed** — the end date has
 * passed. Compares whole calendar days, never instants, so an event that runs
 * "Nov 8" is in progress all of Nov 8 in its own timezone regardless of how
 * the API's date-only strings would parse into a UTC midnight.
 */
export function getEventStatus(event: EventStatusInput, now: Date | number = new Date()): EventLifecycleStatus {
  const today = calendarDay(typeof now === "number" ? new Date(now) : now, event.timezone);
  const start = event.dateStart.slice(0, 10);
  const end = event.dateEnd.slice(0, 10);
  if (today < start) return "upcoming";
  if (today > end) return "completed";
  return "in-progress";
}

export type EventStatusFilter = "all" | EventLifecycleStatus;
export type EventSort = "status" | "newest" | "oldest";

export const EVENT_STATUS_ORDER: EventLifecycleStatus[] = ["in-progress", "upcoming", "completed"];

const byStart = (a: FtcEvent, b: FtcEvent) => a.dateStart.localeCompare(b.dateStart) || a.name.localeCompare(b.name);
const byEnd = (a: FtcEvent, b: FtcEvent) => a.dateEnd.localeCompare(b.dateEnd) || a.name.localeCompare(b.name);

/**
 * "status": In Progress, then Upcoming (soonest first), then Completed (most
 * recent first) — so Completed events always sit below Upcoming ones.
 * "newest" / "oldest": by start date, ignoring status. Never mutates `events`.
 */
export function sortEvents<T extends FtcEvent>(events: T[], sort: EventSort, now: Date | number = new Date()): T[] {
  if (sort === "newest") return [...events].sort((a, b) => byStart(b, a));
  if (sort === "oldest") return [...events].sort(byStart);

  const rank = (e: FtcEvent) => EVENT_STATUS_ORDER.indexOf(getEventStatus(e, now));
  return [...events].sort((a, b) => {
    const ra = rank(a);
    const rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 2) return byEnd(b, a); // completed: most recent first
    return byStart(a, b); // in progress / upcoming: soonest first
  });
}

export function countEventsByStatus(events: FtcEvent[], now: Date | number = new Date()): Record<EventStatusFilter, number> {
  const counts: Record<EventStatusFilter, number> = { all: events.length, "in-progress": 0, upcoming: 0, completed: 0 };
  for (const e of events) counts[getEventStatus(e, now)] += 1;
  return counts;
}
