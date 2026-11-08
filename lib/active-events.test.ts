import { describe, expect, it } from "vitest";
import {
  MAX_ACTIVE_EVENTS,
  type ActiveEventsState,
  buildActiveEventsFields,
  moveActiveEvent,
  needsActiveEventsMigration,
  orderPrimaryFirst,
  pickDefaultActiveEvent,
  readActiveEvents,
  reorderActiveEvents,
  setPrimaryActiveEvent,
  toggleActiveEvent,
} from "./active-events";
import type { FtcEvent } from "./ftc/types";

function ev(code: string, dateStart = "2025-11-08", dateEnd = "2025-11-08"): FtcEvent {
  return { code, season: 2025, name: code, dateStart, dateEnd, city: null, stateProv: null, country: null, venue: null, website: null, timezone: null, status: "upcoming" };
}

const NOW = new Date(2025, 10, 8, 12, 0, 0); // 2025-11-08
const empty: ActiveEventsState = { events: [], primaryCode: null };

describe("readActiveEvents", () => {
  it("reads nothing for a missing team or a team with no event", () => {
    expect(readActiveEvents(null)).toEqual(empty);
    expect(readActiveEvents({ activeEventCode: null, activeEvent: null })).toEqual(empty);
  });

  it("reads a legacy single-event team as a one-event list", () => {
    const a = ev("A");
    expect(readActiveEvents({ activeEventCode: "A", activeEvent: a })).toEqual({ events: [a], primaryCode: "A" });
  });

  it("reads the multi-event fields, de-duplicating by code", () => {
    const a = ev("A");
    const b = ev("B");
    expect(readActiveEvents({ activeEventCode: "B", activeEvents: [a, b, a], activeEventCodes: ["A", "B"] })).toEqual({ events: [b, a], primaryCode: "B" }); // FIX4: the stored primary reads as first
  });

  it("FIX4: a saved primary in the middle reads first, the rest keeping their order", () => {
    const [a, b, c] = [ev("A"), ev("B"), ev("C")];
    const s = readActiveEvents({ activeEventCode: "C", activeEvents: [a, b, c] });
    expect(s.events.map((e) => e.code)).toEqual(["C", "A", "B"]);
    expect(s.primaryCode).toBe("C");
  });

  it("falls back to the first event when the stored primary isn't in the list", () => {
    const a = ev("A");
    expect(readActiveEvents({ activeEventCode: "ZZZ", activeEvents: [a] }).primaryCode).toBe("A");
  });
});

describe("needsActiveEventsMigration", () => {
  it("flags only teams that have an active event but no activeEventCodes yet", () => {
    expect(needsActiveEventsMigration({ activeEventCode: "A", activeEvent: ev("A") })).toBe(true);
    expect(needsActiveEventsMigration({ activeEventCode: "A", activeEventCodes: ["A"] })).toBe(false);
    expect(needsActiveEventsMigration({ activeEventCode: null })).toBe(false);
    expect(needsActiveEventsMigration(null)).toBe(false);
  });
});

describe("toggleActiveEvent / setPrimaryActiveEvent", () => {
  it("makes the first selected event primary", () => {
    expect(toggleActiveEvent(empty, ev("A"))).toEqual({ events: [ev("A")], primaryCode: "A" });
  });

  it("keeps the primary when more events are added", () => {
    const s = toggleActiveEvent(toggleActiveEvent(empty, ev("A")), ev("B"));
    expect(s.events.map((e) => e.code)).toEqual(["A", "B"]);
    expect(s.primaryCode).toBe("A");
  });

  it("promotes the next event when the primary is removed, and clears primary when none remain", () => {
    const two = toggleActiveEvent(toggleActiveEvent(empty, ev("A")), ev("B"));
    const removed = toggleActiveEvent(two, ev("A"));
    expect(removed).toEqual({ events: [ev("B")], primaryCode: "B" });
    expect(toggleActiveEvent(removed, ev("B"))).toEqual(empty);
  });

  it("keeps the primary when a non-primary event is removed", () => {
    const two = toggleActiveEvent(toggleActiveEvent(empty, ev("A")), ev("B"));
    expect(toggleActiveEvent(two, ev("B")).primaryCode).toBe("A");
  });

  it("refuses a selection past the maximum", () => {
    let s = empty;
    for (let i = 0; i < MAX_ACTIVE_EVENTS; i++) s = toggleActiveEvent(s, ev(`E${i}`));
    expect(s.events).toHaveLength(MAX_ACTIVE_EVENTS);
    expect(toggleActiveEvent(s, ev("ONE-TOO-MANY"))).toBe(s);
  });

  it("the star moves an event to first and makes it primary; an unknown code or the current primary is a no-op", () => {
    const two = toggleActiveEvent(toggleActiveEvent(empty, ev("A")), ev("B"));
    const starred = setPrimaryActiveEvent(two, "B");
    expect(starred.events.map((e) => e.code)).toEqual(["B", "A"]);
    expect(starred.primaryCode).toBe("B");
    expect(setPrimaryActiveEvent(two, "NOPE")).toBe(two);
    expect(setPrimaryActiveEvent(two, "A")).toBe(two);
  });

  it("the primary is always the first event, through every operation", () => {
    let s = empty;
    for (const c of ["A", "B", "C", "D"]) s = toggleActiveEvent(s, ev(c));
    const steps = [moveActiveEvent(s, "D", 0), moveActiveEvent(s, "A", 3), setPrimaryActiveEvent(s, "C"), toggleActiveEvent(s, ev("A")), toggleActiveEvent(s, ev("E")), reorderActiveEvents(s, ["B", "A"])];
    for (const x of steps) expect(x.primaryCode).toBe(x.events[0].code);
  });
});

describe("moveActiveEvent / reorderActiveEvents (FIX4)", () => {
  const [a, b, c] = [ev("A"), ev("B"), ev("C")];
  const three: ActiveEventsState = { events: [a, b, c], primaryCode: "A" };
  const codes = (s: ActiveEventsState) => s.events.map((e) => e.code);

  it("moves an event up, down and to the ends, clamping the target", () => {
    expect(codes(moveActiveEvent(three, "C", 1))).toEqual(["A", "C", "B"]);
    expect(codes(moveActiveEvent(three, "A", 1))).toEqual(["B", "A", "C"]);
    expect(codes(moveActiveEvent(three, "B", 99))).toEqual(["A", "C", "B"]);
    expect(codes(moveActiveEvent(three, "C", -5))).toEqual(["C", "A", "B"]);
  });

  it("moving an event to the front makes it primary; moving the primary down hands primary to the next", () => {
    expect(moveActiveEvent(three, "C", 0).primaryCode).toBe("C");
    expect(moveActiveEvent(three, "A", 1).primaryCode).toBe("B");
    expect(moveActiveEvent(three, "B", 2).primaryCode).toBe("A"); // a middle move keeps the primary
  });

  it("returns the same state for no-op moves and unknown codes", () => {
    expect(moveActiveEvent(three, "B", 1)).toBe(three);
    expect(moveActiveEvent(three, "NOPE", 0)).toBe(three);
    expect(moveActiveEvent(empty, "A", 0)).toBe(empty);
  });

  it("reorders from a drag-and-drop result, ignoring unknown and repeated codes and keeping unlisted ones in order at the end", () => {
    expect(codes(reorderActiveEvents(three, ["C", "A", "B"]))).toEqual(["C", "A", "B"]);
    expect(codes(reorderActiveEvents(three, ["B", "ZZZ", "B"]))).toEqual(["B", "A", "C"]);
    expect(reorderActiveEvents(three, ["A", "B", "C"])).toBe(three);
    expect(reorderActiveEvents(three, ["C"]).primaryCode).toBe("C");
  });

  it("is written with the order the admin chose: activeEventCodes[0] is activeEventCode", () => {
    const fields = buildActiveEventsFields(moveActiveEvent(three, "C", 0));
    expect(fields.activeEventCodes).toEqual(["C", "A", "B"]);
    expect(fields.activeEventCode).toBe("C");
    expect(fields.activeEvent?.code).toBe("C");
  });
});

describe("buildActiveEventsFields", () => {
  it("points the legacy fields at the primary and always includes the primary in the list", () => {
    const a = ev("A");
    const b = ev("B");
    const fields = buildActiveEventsFields({ events: [a, b], primaryCode: "B" });
    expect(fields).toEqual({ activeEventCode: "B", activeSeasonId: 2025, activeEvent: b, activeEventCodes: ["B", "A"], activeEvents: [b, a] }); // FIX4: primary first
    expect(fields.activeEventCodes).toContain(fields.activeEventCode);
  });

  it("clears every field when nothing is selected", () => {
    expect(buildActiveEventsFields(empty)).toEqual({ activeEventCode: null, activeSeasonId: null, activeEvent: null, activeEventCodes: [], activeEvents: [] });
  });
});

describe("pickDefaultActiveEvent", () => {
  const live = ev("LIVE", "2025-11-07", "2025-11-09");
  const later = ev("LATER", "2025-12-01", "2025-12-02");

  it("prefers an In Progress active event over the primary", () => {
    expect(pickDefaultActiveEvent({ events: [later, live], primaryCode: "LATER" }, NOW)?.code).toBe("LIVE");
  });

  it("uses the primary when none is in progress", () => {
    expect(pickDefaultActiveEvent({ events: [later, ev("OTHER", "2026-01-01", "2026-01-02")], primaryCode: "OTHER" }, NOW)?.code).toBe("OTHER");
  });

  it("is null with no active events", () => {
    expect(pickDefaultActiveEvent(empty, NOW)).toBeNull();
  });

  it("lists the primary first", () => {
    expect(orderPrimaryFirst({ events: [ev("A"), ev("B")], primaryCode: "B" }).map((e) => e.code)).toEqual(["B", "A"]);
  });
});
