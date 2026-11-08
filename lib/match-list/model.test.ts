import { describe, expect, it } from "vitest";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { IN_PROGRESS_WINDOW_MS, buildMatchRows, defaultTab, filterRows, formatStart, rowsInTab, tabCounts, winnerOf } from "./model";

const ours = new Set([3468, 35792]);
const isOurTeam = (n: number) => ours.has(n);
const TZ = "America/Los_Angeles";
// 2025-11-08 09:00 in Los Angeles (UTC-8 in November)
const NINE_AM = Date.UTC(2025, 10, 8, 17, 0, 0);

function match(over: Partial<OfficialMatch> & Pick<OfficialMatch, "matchType" | "matchNumber">): OfficialMatch {
  return {
    eventCode: "EVT1",
    played: false,
    startTime: null,
    red: { teams: [100, 101], score: null, penaltyPoints: null },
    blue: { teams: [102, 103], score: null, penaltyPoints: null },
    ...over,
  };
}
const played = (matchType: OfficialMatch["matchType"], matchNumber: number, red: number, blue: number, extra: Partial<OfficialMatch> = {}) =>
  match({ matchType, matchNumber, played: true, red: { teams: [100, 101], score: red, penaltyPoints: 0 }, blue: { teams: [102, 103], score: blue, penaltyPoints: 0 }, ...extra });

const build = (matches: OfficialMatch[], now = NINE_AM) => buildMatchRows({ eventCode: "EVT1", matches, timeZone: TZ, now, isOurTeam });

describe("buildMatchRows", () => {
  it("orders rows P, Q, playoffs by number and labels playoffs SF / F with the Scout Status classifier", () => {
    const rows = build([
      match({ matchType: "Playoff", matchNumber: 14, series: 5 }),
      match({ matchType: "Qualification", matchNumber: 2 }),
      match({ matchType: "Playoff", matchNumber: 5, series: 2 }),
      match({ matchType: "Practice", matchNumber: 1 }),
      match({ matchType: "Qualification", matchNumber: 1 }),
    ]);
    expect(rows.map((r) => r.label)).toEqual(["P1", "Q1", "Q2", "SF5", "F14"]);
    expect(rows.map((r) => r.tab)).toEqual(["practice", "qualification", "qualification", "playoff", "playoff"]);
    // Match Breakdown's deep link knows only P / Q / F
    expect(rows.map((r) => r.linkLabel)).toEqual(["P1", "Q1", "Q2", "F5", "F14"]);
  });

  it("only reads the requested event", () => {
    const rows = build([match({ matchType: "Qualification", matchNumber: 1 }), match({ matchType: "Qualification", matchNumber: 1, eventCode: "OTHER" })]);
    expect(rows).toHaveLength(1);
  });

  it("marks a match ours when any of the account's FTC teams (several) is in it, either alliance", () => {
    const rows = build([
      match({ matchType: "Qualification", matchNumber: 1, red: { teams: [3468, 5], score: null, penaltyPoints: null } }),
      match({ matchType: "Qualification", matchNumber: 2, blue: { teams: [9, 35792], score: null, penaltyPoints: null } }),
      match({ matchType: "Qualification", matchNumber: 3 }),
    ]);
    expect(rows.map((r) => r.ours)).toEqual([true, true, false]);
  });

  it("completed matches carry their scores; an unplayed match has none", () => {
    const rows = build([played("Qualification", 1, 120, 98), match({ matchType: "Qualification", matchNumber: 2 })]);
    expect(rows[0]).toMatchObject({ status: "completed", redScore: 120, blueScore: 98 });
    expect(rows[1]).toMatchObject({ status: "upcoming", redScore: null, blueScore: null });
  });

  it("reads a bare start time in the event's time zone", () => {
    const rows = build([match({ matchType: "Qualification", matchNumber: 1, startTime: "2025-11-08T09:00:00" })]);
    expect(rows[0].startMs).toBe(NINE_AM);
  });

  it("the first unplayed match is next; the played ones are completed and never next", () => {
    const rows = build([played("Qualification", 1, 1, 0), played("Qualification", 2, 1, 0), match({ matchType: "Qualification", matchNumber: 3 }), match({ matchType: "Qualification", matchNumber: 4 })]);
    expect(rows.map((r) => r.isNext)).toEqual([false, false, true, false]);
    expect(rows.map((r) => r.status)).toEqual(["completed", "completed", "upcoming", "upcoming"]);
  });

  it("the match whose start just passed is In Progress, and the one after it is next", () => {
    const rows = build(
      [played("Qualification", 1, 1, 0, { startTime: "2025-11-08T08:40:00" }), match({ matchType: "Qualification", matchNumber: 2, startTime: "2025-11-08T08:55:00" }), match({ matchType: "Qualification", matchNumber: 3, startTime: "2025-11-08T09:05:00" })],
      NINE_AM
    );
    expect(rows.map((r) => r.status)).toEqual(["completed", "in-progress", "upcoming"]);
    expect(rows.map((r) => r.isNext)).toEqual([false, false, true]);
  });

  it("a match long past its start (the schedule slipped or it was dropped) is not In Progress, and is still next", () => {
    const rows = build([match({ matchType: "Qualification", matchNumber: 1, startTime: "2025-11-08T07:00:00" })], NINE_AM + IN_PROGRESS_WINDOW_MS);
    expect(rows[0]).toMatchObject({ status: "upcoming", isNext: true });
  });

  it("without start times nothing is In Progress; the first unplayed match is next", () => {
    const rows = build([match({ matchType: "Qualification", matchNumber: 1 }), match({ matchType: "Qualification", matchNumber: 2 })]);
    expect(rows.map((r) => r.status)).toEqual(["upcoming", "upcoming"]);
    expect(rows.map((r) => r.isNext)).toEqual([true, false]);
  });

  it("each tab has its own next match", () => {
    const rows = build([match({ matchType: "Practice", matchNumber: 1 }), match({ matchType: "Qualification", matchNumber: 1 }), match({ matchType: "Qualification", matchNumber: 2 })]);
    expect(rows.filter((r) => r.isNext).map((r) => r.label)).toEqual(["P1", "Q1"]);
  });

  it("no unplayed matches means no next", () => {
    expect(build([played("Qualification", 1, 5, 4)]).some((r) => r.isNext)).toBe(false);
  });
});

describe("tabs", () => {
  const rows = build([played("Practice", 1, 1, 0), played("Qualification", 1, 1, 0), match({ matchType: "Qualification", matchNumber: 2 }), match({ matchType: "Playoff", matchNumber: 1, series: 1 })]);

  it("counts and slices by tab", () => {
    expect(tabCounts(rows)).toEqual({ practice: 1, qualification: 2, playoff: 1 });
    expect(rowsInTab(rows, "qualification").map((r) => r.label)).toEqual(["Q1", "Q2"]);
  });

  it("opens on the tab holding the next match; an over event opens on its latest phase; an empty one on Qualifications", () => {
    expect(defaultTab(rows)).toBe("qualification");
    expect(defaultTab(build([played("Qualification", 1, 1, 0), played("Playoff", 1, 1, 0, { series: 1 })]))).toBe("playoff");
    expect(defaultTab(build([played("Practice", 1, 1, 0)]))).toBe("practice");
    expect(defaultTab([])).toBe("qualification");
  });
});

describe("filterRows", () => {
  const rows = build([
    match({ matchType: "Qualification", matchNumber: 1, red: { teams: [3468, 5], score: null, penaltyPoints: null } }),
    match({ matchType: "Qualification", matchNumber: 2, red: { teams: [254, 1114], score: null, penaltyPoints: null }, blue: { teams: [2056, 67], score: null, penaltyPoints: null } }),
  ]);

  it("Our matches keeps only matches with one of our teams", () => {
    expect(filterRows(rows, { ourOnly: true, search: "" }).map((r) => r.label)).toEqual(["Q1"]);
    expect(filterRows(rows, { ourOnly: false, search: "" })).toHaveLength(2);
  });

  it("searches any team number, red or blue, by prefix or part of the number, ignoring a leading #", () => {
    expect(filterRows(rows, { ourOnly: false, search: "2056" }).map((r) => r.label)).toEqual(["Q2"]);
    expect(filterRows(rows, { ourOnly: false, search: "#34" }).map((r) => r.label)).toEqual(["Q1"]);
    expect(filterRows(rows, { ourOnly: false, search: "11" }).map((r) => r.label)).toEqual(["Q2"]);
    expect(filterRows(rows, { ourOnly: false, search: "999" })).toEqual([]);
  });

  it("combines both filters", () => {
    expect(filterRows(rows, { ourOnly: true, search: "254" })).toEqual([]);
    expect(filterRows(rows, { ourOnly: true, search: "3468" })).toHaveLength(1);
  });
});

describe("winnerOf / formatStart", () => {
  it("names the winner of a scored match", () => {
    expect(winnerOf({ redScore: 10, blueScore: 5 })).toBe("red");
    expect(winnerOf({ redScore: 5, blueScore: 10 })).toBe("blue");
    expect(winnerOf({ redScore: 7, blueScore: 7 })).toBe("tie");
    expect(winnerOf({ redScore: null, blueScore: null })).toBeNull();
  });

  it("formats a start in the event's zone, and says TBD without one", () => {
    // (ICU versions differ on the comma and on a narrow no-break space before AM/PM)
    const plain = (s: string) => s.replace(/[,  ]/g, " ").replace(/s+/g, " ");
    expect(plain(formatStart(NINE_AM, TZ, "en-US"))).toBe("Sat 9:00 AM");
    expect(plain(formatStart(NINE_AM, "America/New_York", "en-US"))).toBe("Sat 12:00 PM");
    expect(formatStart(null, TZ, "en-US")).toBe("Time TBD");
    expect(formatStart(NINE_AM, "Not/AZone", "en-US")).toMatch(/AM|PM/);
  });
});
