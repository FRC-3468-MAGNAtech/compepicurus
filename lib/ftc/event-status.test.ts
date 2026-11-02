import { describe, expect, it } from "vitest";
import { countEventsByStatus, getEventStatus, sortEvents } from "./event-status";
import type { FtcEvent } from "./types";

function ev(code: string, dateStart: string, dateEnd: string, extra: Partial<FtcEvent> = {}): FtcEvent {
  return {
    code,
    season: 2025,
    name: code,
    dateStart,
    dateEnd,
    city: null,
    stateProv: null,
    country: null,
    venue: null,
    website: null,
    timezone: null,
    status: "upcoming",
    ...extra,
  };
}

// Noon local time, so the local-timezone fallback lands on the same calendar day.
const NOW = new Date(2025, 10, 8, 12, 0, 0); // 2025-11-08

describe("getEventStatus", () => {
  it("is upcoming before the start date", () => {
    expect(getEventStatus(ev("a", "2025-11-09", "2025-11-09"), NOW)).toBe("upcoming");
  });

  it("is in progress on the start date, the end date, and between them", () => {
    expect(getEventStatus(ev("a", "2025-11-08", "2025-11-09"), NOW)).toBe("in-progress");
    expect(getEventStatus(ev("a", "2025-11-07", "2025-11-08"), NOW)).toBe("in-progress");
    expect(getEventStatus(ev("a", "2025-11-06", "2025-11-10"), NOW)).toBe("in-progress");
  });

  it("is completed once the end date has passed", () => {
    expect(getEventStatus(ev("a", "2025-11-05", "2025-11-07"), NOW)).toBe("completed");
  });

  it("accepts datetime strings and a timestamp for `now`", () => {
    expect(getEventStatus(ev("a", "2025-11-08T00:00:00", "2025-11-08T00:00:00"), NOW.getTime())).toBe("in-progress");
  });

  it("evaluates 'today' in the event's own timezone", () => {
    // 2025-11-09T03:00Z is still Nov 8 in Los Angeles, but already Nov 9 in UTC.
    const instant = new Date("2025-11-09T03:00:00Z");
    const event = ev("a", "2025-11-08", "2025-11-08");
    expect(getEventStatus({ ...event, timezone: "America/Los_Angeles" }, instant)).toBe("in-progress");
    expect(getEventStatus({ ...event, timezone: "UTC" }, instant)).toBe("completed");
  });

  it("ignores an unknown timezone id instead of throwing", () => {
    expect(getEventStatus({ ...ev("a", "2025-11-08", "2025-11-08"), timezone: "Not/AZone" }, NOW)).toBe("in-progress");
  });
});

describe("sortEvents", () => {
  const events = [
    ev("done-old", "2025-10-01", "2025-10-02"),
    ev("later", "2025-12-20", "2025-12-21"),
    ev("done-new", "2025-11-01", "2025-11-02"),
    ev("soon", "2025-11-15", "2025-11-16"),
    ev("now", "2025-11-07", "2025-11-09"),
  ];

  it("status: In Progress, then Upcoming soonest first, then Completed most recent first", () => {
    expect(sortEvents(events, "status", NOW).map((e) => e.code)).toEqual(["now", "soon", "later", "done-new", "done-old"]);
  });

  it("always keeps Completed below Upcoming", () => {
    const codes = sortEvents(events, "status", NOW).map((e) => e.code);
    expect(codes.indexOf("later")).toBeLessThan(codes.indexOf("done-new"));
  });

  it("newest / oldest sort by start date and do not mutate the input", () => {
    const before = events.map((e) => e.code);
    expect(sortEvents(events, "newest", NOW).map((e) => e.code)).toEqual(["later", "soon", "now", "done-new", "done-old"]);
    expect(sortEvents(events, "oldest", NOW).map((e) => e.code)).toEqual(["done-old", "done-new", "now", "soon", "later"]);
    expect(events.map((e) => e.code)).toEqual(before);
  });
});

describe("countEventsByStatus", () => {
  it("counts each bucket and the total", () => {
    const events = [ev("a", "2025-11-08", "2025-11-08"), ev("b", "2025-12-01", "2025-12-02"), ev("c", "2025-10-01", "2025-10-02"), ev("d", "2025-10-05", "2025-10-06")];
    expect(countEventsByStatus(events, NOW)).toEqual({ all: 4, "in-progress": 1, upcoming: 1, completed: 2 });
  });
});
