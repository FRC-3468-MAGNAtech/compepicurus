import { describe, expect, it } from "vitest";
import { selectAnalyticsEntries, type AnalyticsEntry } from "@/lib/analytics/entries";
import { DEFAULT_FILTERS } from "@/lib/analytics/filters";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { MatchType } from "@/lib/ftc/types";
import { initialScoutEntryFields, type ScoutEntry } from "@/lib/scout-entries";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import { canEditScoutTargets } from "./permissions";
import { classifyMatch, finalsMatchNumbers, statusMatchLabel } from "./categories";
import { EMPTY_SETUP, buildCoverage, buildEventContext, buildScoutRows, individualTargets, matchKeyOf, maxTargets, playedFractionOf, scoutStatusPill, sumTargets, summarizeAssignments, targetScouts, totalsRow, type EventSetup } from "./compute";
import { countInRanges, formatRanges, inRanges, parseRangeText, rangeNumbers } from "./ranges";

// ---------------------------------------------------------------------------------------------
// Fixtures

const ALL = new Set(["practice", "qualification", "semi", "final"] as const);

function official(matchType: MatchType, matchNumber: number, over: Partial<OfficialMatch> = {}): OfficialMatch {
  return {
    eventCode: "EV1",
    matchType,
    matchNumber,
    played: true,
    red: { teams: [100 + matchNumber, 200 + matchNumber], score: 50, penaltyPoints: 0 },
    blue: { teams: [300 + matchNumber, 400 + matchNumber], score: 40, penaltyPoints: 0 },
    ...over,
  };
}

function entry(uid: string, matchType: MatchType, matchNumber: number, teamNumber: number, over: Partial<AnalyticsEntry> = {}): AnalyticsEntry {
  return {
    id: `${uid}-${matchType}-${matchNumber}-${teamNumber}`,
    teamId: "t",
    uid,
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: uid.toUpperCase(),
    eventCode: "EV1",
    matchType,
    matchNumber,
    teamNumber,
    fields: initialScoutEntryFields,
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: `2026-11-05T10:${String(matchNumber).padStart(2, "0")}:00.000Z`,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    allianceAccuracy: 90,
    isExcluded: false,
    ...over,
  } as AnalyticsEntry;
}

// ---------------------------------------------------------------------------------------------

describe("classifyMatch: Practice, Qualifications, Semi-Finals, Finals", () => {
  const playoffs = (rows: [number, number | null][]) => rows.map(([matchNumber, series]) => ({ matchType: "Playoff" as const, matchNumber, series }));

  it("practice and qualification are themselves", () => {
    expect(classifyMatch({ matchType: "Practice", matchNumber: 3 }, [])).toBe("practice");
    expect(classifyMatch({ matchType: "Qualification", matchNumber: 12 }, [])).toBe("qualification");
  });

  it("finds a 2-match finals series by the highest series number", () => {
    // 8-alliance double-elim: series 1-13 are the bracket, series 14 is the finals — played as M14 and a possible M15.
    const matches = playoffs([...Array.from({ length: 13 }, (_, i): [number, number] => [i + 1, i + 1]), [14, 14], [15, 14]]);
    expect([...finalsMatchNumbers(matches)].sort((a, b) => a - b)).toEqual([14, 15]);
    expect(classifyMatch(matches[13], matches)).toBe("final");
    expect(classifyMatch(matches[14], matches)).toBe("final");
    expect(classifyMatch(matches[12], matches)).toBe("semi");
    expect(classifyMatch(matches[0], matches)).toBe("semi");
  });

  it("finds a 3-match finals series", () => {
    const matches = playoffs([[1, 1], [2, 2], [3, 3], [4, 4], [5, 5], [6, 5], [7, 5]]);
    expect([...finalsMatchNumbers(matches)].sort((a, b) => a - b)).toEqual([5, 6, 7]);
    expect(matches.map((m) => classifyMatch(m, matches))).toEqual(["semi", "semi", "semi", "semi", "final", "final", "final"]);
  });

  it("a finals series that hasn't started yet (no higher series played) is not guessed early", () => {
    const matches = playoffs([[1, 1], [2, 2], [3, 3]]);
    expect([...finalsMatchNumbers(matches)]).toEqual([3]); // the latest series known so far
  });

  it("without series data the highest-numbered playoff match is the finals", () => {
    const matches = playoffs([[1, null], [2, null], [3, null]]);
    expect([...finalsMatchNumbers(matches)]).toEqual([3]);
    expect(classifyMatch({ matchType: "Playoff", matchNumber: 2 }, matches)).toBe("semi");
  });

  it("a typed Finals range overrides detection when the API data is ambiguous", () => {
    const matches = playoffs([[1, null], [2, null], [3, null], [4, null]]);
    const override = new Set([3, 4]);
    expect(classifyMatch(matches[2], matches, override)).toBe("final");
    expect(classifyMatch(matches[3], matches, override)).toBe("final");
    expect(classifyMatch(matches[1], matches, override)).toBe("semi");
  });

  it("no playoffs at all means no finals", () => {
    expect(finalsMatchNumbers([{ matchType: "Qualification", matchNumber: 1 }]).size).toBe(0);
  });

  it("labels are P12 / Q12 / SF5 / F14", () => {
    expect(statusMatchLabel("practice", 12)).toBe("P12");
    expect(statusMatchLabel("qualification", 12)).toBe("Q12");
    expect(statusMatchLabel("semi", 5)).toBe("SF5");
    expect(statusMatchLabel("final", 14)).toBe("F14");
  });
});

describe("range entry", () => {
  it("parses ranges and single numbers, merges overlaps, and counts the matches selected", () => {
    const p = parseRangeText("2-4, 8, 10-12");
    expect(p).toMatchObject({ all: false, errors: [], ranges: [[2, 4], [8, 8], [10, 12]] });
    expect(countInRanges(p, [1, 2, 3, 4, 5, 8, 9, 10, 11, 12, 13])).toBe(7);
    expect(formatRanges(p)).toBe("2-4, 8, 10-12");
  });

  it("merges overlapping and touching ranges, in any order", () => {
    expect(parseRangeText("5-7, 1-3, 2-4").ranges).toEqual([[1, 7]]);
    expect(parseRangeText("1-3, 4-6").ranges).toEqual([[1, 6]]); // touching
    expect(parseRangeText("1-3, 5").ranges).toEqual([[1, 3], [5, 5]]);
    expect(parseRangeText("3, 3, 3").ranges).toEqual([[3, 3]]);
  });

  it("a blank input means every match", () => {
    for (const text of ["", "   ", " , ,"]) {
      const p = parseRangeText(text);
      expect(p.all).toBe(true);
      expect(inRanges(p, 999)).toBe(true);
    }
  });

  it("reports unreadable chips while keeping the readable ones", () => {
    const p = parseRangeText("2-4, abc, 9-7, 0, 6");
    expect(p.ranges).toEqual([[2, 4], [6, 6]]);
    expect(p.errors).toHaveLength(3);
    expect(parseRangeText("a-b").all).toBe(false); // an invalid entry isn't "everything"
  });

  it("tolerates spaces and a trailing comma while typing", () => {
    expect(parseRangeText(" 2 - 4 , 8 ,").ranges).toEqual([[2, 4], [8, 8]]);
  });

  it("a range's numbers, for overriding the finals", () => {
    expect([...rangeNumbers(parseRangeText("14-15"))!]).toEqual([14, 15]);
    expect(rangeNumbers(parseRangeText(""))).toBeNull();
  });
});

describe("event context: categories, ranges, and the category filter", () => {
  const matches = [official("Practice", 1), official("Practice", 2), ...Array.from({ length: 10 }, (_, i) => official("Qualification", i + 1)), official("Playoff", 1, { series: 1 }), official("Playoff", 2, { series: 2 })];

  it("counts every match in an enabled category, with no ranges set", () => {
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup: EMPTY_SETUP, enabled: ALL });
    const byCat = (c: string) => ctx.matches.filter((m) => m.category === c).length;
    expect([byCat("practice"), byCat("qualification"), byCat("semi"), byCat("final")]).toEqual([2, 10, 1, 1]);
  });

  it("drops categories the filter turns off", () => {
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup: EMPTY_SETUP, enabled: new Set(["qualification"]) });
    expect(ctx.matches.every((m) => m.category === "qualification")).toBe(true);
    expect(ctx.includes("Practice", 1)).toBe(false);
  });

  it("limits a category to its range, by official match number", () => {
    const setup: EventSetup = { ...EMPTY_SETUP, ranges: { qualification: "2-4, 8" } };
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup, enabled: ALL });
    expect(ctx.matches.filter((m) => m.category === "qualification").map((m) => m.matchNumber)).toEqual([2, 3, 4, 8]);
  });

  it("a Finals range overrides which playoff matches are the finals", () => {
    const setup: EventSetup = { ...EMPTY_SETUP, ranges: { final: "1" } };
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup, enabled: ALL });
    expect(ctx.matches.filter((m) => m.category === "final").map((m) => m.label)).toEqual(["F1"]);
    expect(ctx.matches.filter((m) => m.category === "semi").map((m) => m.label)).toEqual(["SF2"]);
  });

  it("uses P / Q / SF / F labels and orders by category then number", () => {
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup: EMPTY_SETUP, enabled: ALL });
    expect(ctx.matches.map((m) => m.label).slice(0, 3)).toEqual(["P1", "P2", "Q1"]);
    expect(ctx.matches[ctx.matches.length - 1].label).toBe("F2");
  });
});

describe("max targets", () => {
  const matches = Array.from({ length: 10 }, (_, i) => official("Qualification", i + 1));

  it("come from the schedule, marked 'api'", () => {
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup: EMPTY_SETUP, enabled: ALL });
    expect(maxTargets(ctx, EMPTY_SETUP, ALL).qualification).toEqual({ value: 10, source: "api" });
  });

  it("follow the range", () => {
    const setup: EventSetup = { ...EMPTY_SETUP, ranges: { qualification: "1-4" } };
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup, enabled: ALL });
    expect(maxTargets(ctx, setup, ALL).qualification.value).toBe(4);
  });

  it("can be overridden by hand, marked 'manual' (and reset by removing the override)", () => {
    const setup: EventSetup = { ...EMPTY_SETUP, maxOverrides: { qualification: 6 } };
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup, enabled: ALL });
    expect(maxTargets(ctx, setup, ALL).qualification).toEqual({ value: 6, source: "manual" });
    expect(maxTargets(ctx, EMPTY_SETUP, ALL).qualification).toEqual({ value: 10, source: "api" });
  });

  it("are manual (blank) when there is no schedule, e.g. a manual library event", () => {
    const ctx = buildEventContext({ eventCode: "MAN-T", matches: [], setup: EMPTY_SETUP, enabled: ALL });
    expect(maxTargets(ctx, EMPTY_SETUP, ALL).qualification).toEqual({ value: null, source: "manual" });
    expect(maxTargets(ctx, { ...EMPTY_SETUP, maxOverrides: { qualification: 12 } }, ALL).qualification).toEqual({ value: 12, source: "manual" });
  });

  it("are 0 for a category the filter turned off", () => {
    const ctx = buildEventContext({ eventCode: "EV1", matches, setup: EMPTY_SETUP, enabled: new Set(["practice"]) });
    expect(maxTargets(ctx, EMPTY_SETUP, new Set(["practice"])).qualification.value).toBe(0);
  });
});

describe("individual targets from Assignments", () => {
  const matches = [...Array.from({ length: 6 }, (_, i) => official("Qualification", i + 1)), official("Practice", 1)];
  const ctx = buildEventContext({ eventCode: "EV1", matches, setup: EMPTY_SETUP, enabled: ALL });
  const maxes = maxTargets(ctx, EMPTY_SETUP, ALL);
  const slot = (matchType: MatchType, matchNumber: number, scoutUid: string | null, teamNumber: number): ScheduleSlot => ({ matchType, matchNumber, slot: "red1", teamNumber, scoutUid });

  it("counts distinct assigned matches per category, not slots", () => {
    const slots = [slot("Qualification", 1, "a", 101), slot("Qualification", 1, "a", 201), slot("Qualification", 2, "a", 102), slot("Practice", 1, "a", 101), slot("Qualification", 3, "b", 103), slot("Qualification", 4, null, 104)];
    const assigned = summarizeAssignments(ctx, slots);
    expect(assigned.counts.get("a")).toMatchObject({ qualification: 2, practice: 1 });
    expect(assigned.counts.get("b")).toMatchObject({ qualification: 1 });
    expect(assigned.counts.has("nobody")).toBe(false);
  });

  it("prefill each cell from assignments when a schedule exists, marked 'assignments'", () => {
    const assigned = summarizeAssignments(ctx, [slot("Qualification", 1, "a", 101), slot("Qualification", 2, "a", 102)]);
    const cells = individualTargets("a", EMPTY_SETUP, assigned, maxes, ALL);
    expect(cells.qualification).toEqual({ value: 2, source: "assignments" });
    expect(cells.practice).toEqual({ value: 0, source: "assignments" });
    expect(individualTargets("c", EMPTY_SETUP, assigned, maxes, ALL).qualification).toEqual({ value: 0, source: "assignments" }); // a scout with no slots is assigned 0
  });

  it("are blank (manual) with no published schedule", () => {
    const cells = individualTargets("a", EMPTY_SETUP, summarizeAssignments(ctx, null), maxes, ALL);
    expect(cells.qualification).toEqual({ value: null, source: "none" });
  });

  it("a manual number overrides the prefill, and is clamped between 0 and the category's max", () => {
    const assigned = summarizeAssignments(ctx, [slot("Qualification", 1, "a", 101)]);
    const setup = (n: number): EventSetup => ({ ...EMPTY_SETUP, individual: { a: { qualification: n } } });
    expect(individualTargets("a", setup(4), assigned, maxes, ALL).qualification).toEqual({ value: 4, source: "manual" });
    expect(individualTargets("a", setup(99), assigned, maxes, ALL).qualification.value).toBe(6); // the max
    expect(individualTargets("a", setup(-3), assigned, maxes, ALL).qualification.value).toBe(0);
  });

  it("only count assigned matches inside the ranges and enabled categories", () => {
    const narrow = buildEventContext({ eventCode: "EV1", matches, setup: { ...EMPTY_SETUP, ranges: { qualification: "1-2" } }, enabled: new Set(["qualification"]) });
    const assigned = summarizeAssignments(narrow, [slot("Qualification", 1, "a", 101), slot("Qualification", 5, "a", 105), slot("Practice", 1, "a", 101)]);
    expect(assigned.counts.get("a")).toMatchObject({ qualification: 1, practice: 0 });
  });

  it("are disabled (0) for a category the filter turned off", () => {
    const cells = individualTargets("a", EMPTY_SETUP, summarizeAssignments(ctx, null), maxes, new Set(["qualification"]));
    expect(cells.practice).toEqual({ value: 0, source: "none" });
  });
});

describe("aggregating across several events", () => {
  it("sums each scout's targets event by event, keeping blank only when it's blank everywhere", () => {
    const a = new Map([["u", { practice: { value: 2, source: "manual" }, qualification: { value: 5, source: "manual" }, semi: { value: null, source: "none" }, final: { value: null, source: "none" } }]]);
    const b = new Map([["u", { practice: { value: 1, source: "manual" }, qualification: { value: null, source: "none" }, semi: { value: null, source: "none" }, final: { value: null, source: "none" } }]]);
    const sum = sumTargets([a, b] as never).get("u")!;
    expect(sum).toEqual({ practice: 3, qualification: 5, semi: null, final: null });
  });

  it("counts entries and matches across events, and keeps the same match number in two events apart", () => {
    const ev1 = buildEventContext({ eventCode: "EV1", matches: [official("Qualification", 1), official("Qualification", 2)], setup: EMPTY_SETUP, enabled: ALL });
    const ev2 = buildEventContext({ eventCode: "EV2", matches: [official("Qualification", 1, { eventCode: "EV2" })], setup: EMPTY_SETUP, enabled: ALL });
    const rows = buildScoutRows({
      scouts: [{ uid: "a", name: "A", role: null, inTargets: true }],
      entries: [entry("a", "Qualification", 1, 101), entry("a", "Qualification", 2, 102), entry("a", "Qualification", 1, 101, { eventCode: "EV2" })],
      events: [ev1, ev2],
      targets: new Map([["a", { practice: null, qualification: 3, semi: null, final: null }]]),
      assignedSlots: new Map(),
      hasAssignments: false,
      playedFraction: 1,
    });
    expect(rows[0]).toMatchObject({ entries: 3, matchesScouted: 3, target: 3, status: "complete" });
    expect(rows[0].lastEntry?.label).toContain("EV"); // events are named in labels once there is more than one
  });

  it("the played fraction spans every event's schedule", () => {
    const ev1 = buildEventContext({ eventCode: "EV1", matches: [official("Qualification", 1), official("Qualification", 2, { played: false })], setup: EMPTY_SETUP, enabled: ALL });
    const ev2 = buildEventContext({ eventCode: "EV2", matches: [official("Qualification", 1, { played: false, eventCode: "EV2" }), official("Qualification", 2, { played: false, eventCode: "EV2" })], setup: EMPTY_SETUP, enabled: ALL });
    expect(playedFractionOf([ev1, ev2])).toBe(0.25);
    expect(playedFractionOf([buildEventContext({ eventCode: "X", matches: [], setup: EMPTY_SETUP, enabled: ALL })])).toBeNull();
  });
});

describe("scout status pill", () => {
  it("Not started with 0 entries, Complete at or past the target", () => {
    expect(scoutStatusPill({ entries: 0, target: 10, playedFraction: 0.5 })).toBe("not-started");
    expect(scoutStatusPill({ entries: 10, target: 10, playedFraction: 0.5 })).toBe("complete");
    expect(scoutStatusPill({ entries: 12, target: 10, playedFraction: 1 })).toBe("complete");
  });

  it("On track vs Behind compares progress with how much of the schedule has been played", () => {
    expect(scoutStatusPill({ entries: 5, target: 10, playedFraction: 0.5 })).toBe("on-track"); // exactly keeping pace
    expect(scoutStatusPill({ entries: 4, target: 10, playedFraction: 0.5 })).toBe("on-track"); // 0.4 >= 0.5 * 0.8
    expect(scoutStatusPill({ entries: 3, target: 10, playedFraction: 0.5 })).toBe("behind");
    expect(scoutStatusPill({ entries: 1, target: 10, playedFraction: 1 })).toBe("behind");
  });

  it("is On track when the schedule's progress is unknown", () => {
    expect(scoutStatusPill({ entries: 1, target: 10, playedFraction: null })).toBe("on-track");
  });

  it("has no verdict without a target", () => {
    expect(scoutStatusPill({ entries: 3, target: null, playedFraction: 0.5 })).toBe("no-target");
    expect(scoutStatusPill({ entries: 3, target: 0, playedFraction: 0.5 })).toBe("no-target");
  });
});

describe("the status table", () => {
  const ctx = buildEventContext({ eventCode: "EV1", matches: [official("Qualification", 1), official("Qualification", 2), official("Qualification", 3)], setup: EMPTY_SETUP, enabled: ALL });
  const base = {
    scouts: [{ uid: "a", name: "Ada", role: "Match Scout", inTargets: true }, { uid: "b", name: "Bo", role: "Match Scout", inTargets: true }],
    events: [ctx],
    targets: new Map([["a", { practice: null, qualification: 3, semi: null, final: null }], ["b", { practice: null, qualification: 2, semi: null, final: null }]]),
    assignedSlots: new Map<string, Set<string>>(),
    hasAssignments: false,
    playedFraction: 1,
  };

  it("counts matches scouted (distinct) separately from entries (a scout can scout two robots in a match)", () => {
    const rows = buildScoutRows({ ...base, entries: [entry("a", "Qualification", 1, 101), entry("a", "Qualification", 1, 201), entry("a", "Qualification", 2, 102)] });
    expect(rows[0]).toMatchObject({ matchesScouted: 2, entries: 3, target: 3, status: "complete" });
    expect(rows[1]).toMatchObject({ matchesScouted: 0, entries: 0, status: "not-started" });
  });

  it("breaks entries down per category with each category's target", () => {
    const rows = buildScoutRows({ ...base, entries: [entry("a", "Qualification", 1, 101)] });
    expect(rows[0].byCategory.qualification).toEqual({ entries: 1, target: 3 });
    expect(rows[0].byCategory.practice).toEqual({ entries: 0, target: null });
  });

  it("reports the last entry, the average accuracy, and flagged entries", () => {
    const rows = buildScoutRows({
      ...base,
      entries: [
        entry("a", "Qualification", 1, 101, { allianceAccuracy: 80 }),
        entry("a", "Qualification", 2, 102, { allianceAccuracy: 100, autoFlags: [{ ruleId: "x", dismissed: false }] }),
        entry("a", "Qualification", 3, 103, { allianceAccuracy: null, autoFlags: [{ ruleId: "y", dismissed: true }] }),
      ],
    });
    expect(rows[0].avgAccuracy).toBe(90); // null accuracies aren't averaged in
    expect(rows[0].flagged).toBe(1); // a dismissed flag doesn't count
    expect(rows[0].lastEntry).toMatchObject({ label: "Q3" });
  });

  it("lists a scout who has entries but isn't in the targets list, flagged 'not in targets'", () => {
    const rows = buildScoutRows({ ...base, entries: [entry("z", "Qualification", 1, 101, { scoutName: "Zed" })] });
    const zed = rows.find((r) => r.uid === "z")!;
    expect(zed).toMatchObject({ name: "Zed", inTargets: false, entries: 1, status: "no-target" });
  });

  it("ignores entries outside the category filter and the ranges", () => {
    const narrow = buildEventContext({ eventCode: "EV1", matches: [official("Qualification", 1), official("Qualification", 2), official("Qualification", 3)], setup: { ...EMPTY_SETUP, ranges: { qualification: "1-2" } }, enabled: ALL });
    const rows = buildScoutRows({ ...base, events: [narrow], entries: [entry("a", "Qualification", 1, 101), entry("a", "Qualification", 3, 103)] });
    expect(rows[0].entries).toBe(1);
    const off = buildEventContext({ eventCode: "EV1", matches: [official("Qualification", 1)], setup: EMPTY_SETUP, enabled: new Set(["practice"]) });
    expect(buildScoutRows({ ...base, events: [off], entries: [entry("a", "Qualification", 1, 101)] })[0].entries).toBe(0);
  });

  it("counts assigned robots a scout hasn't scouted, only when a schedule is published", () => {
    const assignedSlots = new Map([["a", new Set([`${matchKeyOf("EV1", "Qualification", 1)}|101`, `${matchKeyOf("EV1", "Qualification", 2)}|102`])]]);
    const entries = [entry("a", "Qualification", 1, 101)];
    expect(buildScoutRows({ ...base, entries, assignedSlots, hasAssignments: true })[0].missingAssigned).toBe(1);
    expect(buildScoutRows({ ...base, entries, assignedSlots, hasAssignments: false })[0].missingAssigned).toBeNull();
    expect(buildScoutRows({ ...base, entries, assignedSlots, hasAssignments: true })[1].missingAssigned).toBe(0);
  });

  it("totals the rows", () => {
    const rows = buildScoutRows({ ...base, entries: [entry("a", "Qualification", 1, 101), entry("b", "Qualification", 2, 102)] });
    expect(totalsRow(rows)).toMatchObject({ entries: 2, matchesScouted: 2, target: 5 });
  });
});

describe("the accuracy filter drives every number", () => {
  const rawEntry = (uid: string, n: number, accuracy: number | null): ScoutEntry => {
    const e = entry(uid, "Qualification", n, 100 + n);
    return { ...e, accuracy: accuracy === null ? { status: "pending", value: null, scoutedTotal: null, penaltyPoints: null, officialScore: null } : { status: "complete", value: accuracy / 100, scoutedTotal: 1, penaltyPoints: 0, officialScore: 1 } } as ScoutEntry;
  };
  const entries = [rawEntry("a", 1, 95), rawEntry("a", 2, 70), rawEntry("a", 3, null), rawEntry("a", 4, 75)];
  const ctx = buildEventContext({ eventCode: "EV1", matches: [1, 2, 3, 4].map((n) => official("Qualification", n)), setup: EMPTY_SETUP, enabled: ALL });
  const rowsFor = (accuracy: number | null) => {
    const { used } = selectAnalyticsEntries({ entries, sessionsById: new Map(), filters: { ...DEFAULT_FILTERS, accuracy }, activeEventCodes: ["EV1"] });
    const rows = buildScoutRows({ scouts: [{ uid: "a", name: "A", role: null, inTargets: true }], entries: used, events: [ctx], targets: new Map(), assignedSlots: new Map(), hasAssignments: false, playedFraction: 1 });
    return { row: rows[0], coverage: buildCoverage({ events: [ctx], entries: used, practiceDataset: false }) };
  };

  it("with no threshold every entry counts", () => {
    expect(rowsFor(null).row).toMatchObject({ entries: 4, matchesScouted: 4 });
  });

  it("with a threshold only entries whose accuracy is computable and at or above it count — in the table and in the coverage ticks", () => {
    const { row, coverage } = rowsFor(75);
    expect(row).toMatchObject({ entries: 2, matchesScouted: 2 }); // 95 and 75; 70 is below, and the pending one has no accuracy
    const ticks = coverage.map((m) => m.scoutedCount);
    expect(ticks).toEqual([1, 0, 0, 1]);
  });

  it("an entry the filter excludes never counts, however it is scored", () => {
    expect(rowsFor(90).row.entries).toBe(1);
  });
});

describe("match coverage", () => {
  const upcoming = official("Qualification", 2, { played: false });
  const ctx = buildEventContext({ eventCode: "EV1", matches: [official("Qualification", 1), upcoming], setup: EMPTY_SETUP, enabled: ALL });

  it("groups robots by alliance, red pair then blue pair", () => {
    const [m1] = buildCoverage({ events: [ctx], entries: [], practiceDataset: false });
    expect(m1.robots.map((r) => [r.alliance, r.teamNumber])).toEqual([["red", 101], ["red", 201], ["blue", 301], ["blue", 401]]);
  });

  it("shows a check per scout: two scouts on one robot make two checks, with their names", () => {
    const entries = [entry("a", "Qualification", 1, 101, { scoutName: "Ada" }), entry("b", "Qualification", 1, 101, { scoutName: "Bo" }), entry("a", "Qualification", 1, 301, { scoutName: "Ada" })];
    const [m1] = buildCoverage({ events: [ctx], entries, practiceDataset: false });
    expect(m1.robots.find((r) => r.teamNumber === 101)!.scouts.map((s) => s.name).sort()).toEqual(["Ada", "Bo"]);
    expect(m1.robots.find((r) => r.teamNumber === 301)!.scouts).toHaveLength(1);
    expect(m1.scoutedCount).toBe(2); // robots with at least one scout: 101 and 301
  });

  it("counts the same scout twice on one robot as one check", () => {
    const entries = [entry("a", "Qualification", 1, 101), { ...entry("a", "Qualification", 1, 101), id: "dupe" }];
    expect(buildCoverage({ events: [ctx], entries, practiceDataset: false })[0].robots[0].scouts).toHaveLength(1);
  });

  it("keeps an unplayed match muted (upcoming), and treats the practice dataset as all played", () => {
    const coverage = buildCoverage({ events: [ctx], entries: [], practiceDataset: false });
    expect(coverage.map((c) => c.state)).toEqual(["played", "upcoming"]);
    expect(buildCoverage({ events: [ctx], entries: [], practiceDataset: true }).map((c) => c.state)).toEqual(["played", "played"]);
  });

  it("matches entries by event, type, and number — a Q1 from another event doesn't tick this Q1", () => {
    const [m1] = buildCoverage({ events: [ctx], entries: [entry("a", "Qualification", 1, 101, { eventCode: "OTHER" })], practiceDataset: false });
    expect(m1.scoutedCount).toBe(0);
  });
});

describe("who is in the targets table", () => {
  const members = [
    { uid: "a", name: "Ada", primaryRole: "match-scout", secondaryRoles: [] },
    { uid: "b", name: "Bo", primaryRole: "drive-team", secondaryRoles: ["match-scout"] },
    { uid: "c", name: "Cy", primaryRole: "match-scout", secondaryRoles: [] },
    { uid: "d", name: "Di", primaryRole: "media", secondaryRoles: [] },
  ];
  const roleLabel = (r: string) => r;

  it("lists Match Scouts (primary or secondary role) who are attending", () => {
    const rows = targetScouts({ members, attendingUids: new Set(["a", "b", "d"]), extraUids: new Set(), roleLabel });
    expect(rows.map((r) => r.uid)).toEqual(["a", "b"]); // c isn't attending; d isn't a Match Scout
  });

  it("adds anyone included by hand", () => {
    const rows = targetScouts({ members, attendingUids: new Set(["a"]), extraUids: new Set(["d"]), roleLabel });
    expect(rows.map((r) => r.uid)).toEqual(["a", "d"]);
  });
});

describe("who can edit targets", () => {
  it("admins and Lead Scouts (primary or secondary) — nobody else", () => {
    expect(canEditScoutTargets({ isAdmin: true, primaryRole: "media", secondaryRoles: [] })).toBe(true);
    expect(canEditScoutTargets({ isAdmin: false, primaryRole: "lead-scout", secondaryRoles: [] })).toBe(true);
    expect(canEditScoutTargets({ isAdmin: false, primaryRole: "match-scout", secondaryRoles: ["lead-scout"] })).toBe(true);
    expect(canEditScoutTargets({ isAdmin: false, primaryRole: "match-scout", secondaryRoles: [] })).toBe(false);
    expect(canEditScoutTargets({ isAdmin: false, primaryRole: "lead-strategist", secondaryRoles: [] })).toBe(false);
    expect(canEditScoutTargets(null)).toBe(false);
  });
});
