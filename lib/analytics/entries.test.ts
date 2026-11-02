import { describe, expect, it } from "vitest";
import { initialScoutEntryFields, type AccuracyResult, type ScoutEntry } from "@/lib/scout-entries";
import { DEFAULT_FILTERS, type AnalyticsFilters } from "./filters";
import { passesAccuracy, selectAnalyticsEntries, toAnalyticsEntry, type SessionAccuracy } from "./entries";

function entry(id: string, overrides: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "Scout",
    eventCode: "EVT1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 100,
    fields: initialScoutEntryFields,
    score: { auto: 10, teleop: 20, endgame: 5, total: 35 },
    comments: "",
    submittedAt: "2026-01-01T00:00:00.000Z",
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...overrides,
  };
}

const complete = (pct: number): AccuracyResult => ({ status: "complete", value: pct / 100, scoutedTotal: 1, penaltyPoints: 0, officialScore: 1 });
const session = (accuracy: number | null, excluded = false): SessionAccuracy => ({ accuracy, excluded, scoutedTotal: 1, penaltyPoints: 0, officialScore: 1 });

const filters = (over: Partial<AnalyticsFilters> = {}): AnalyticsFilters => ({ ...DEFAULT_FILTERS, ...over });

describe("toAnalyticsEntry", () => {
  it("takes a real-event entry's stored alliance accuracy as a 0-100 percent", () => {
    expect(toAnalyticsEntry(entry("a", { accuracy: complete(87) })).allianceAccuracy).toBeCloseTo(87);
  });

  it("has no accuracy when it can't be computed", () => {
    for (const status of ["needs-robots", "awaiting-results", "not-applicable"] as const) {
      const acc: AccuracyResult = { status, value: null, scoutedTotal: null, penaltyPoints: null, officialScore: null };
      expect(toAnalyticsEntry(entry("a", { accuracy: acc })).allianceAccuracy).toBeNull();
    }
    expect(toAnalyticsEntry(entry("a")).allianceAccuracy).toBeNull();
  });

  it("uses the session's accuracy and exclusion for a practice entry", () => {
    const joined = toAnalyticsEntry(entry("p", { source: "practice", mode: "trial", sessionId: "s1" }), session(92, true));
    expect(joined.allianceAccuracy).toBe(92);
    expect(joined.accuracy?.status).toBe("complete");
    expect(joined.isExcluded).toBe(true);
  });

  it("gives a practice entry with an unscored session no accuracy", () => {
    expect(toAnalyticsEntry(entry("p", { source: "live", sessionId: "s1" }), session(null)).allianceAccuracy).toBeNull();
    expect(toAnalyticsEntry(entry("p", { source: "live", sessionId: "gone" }), undefined).allianceAccuracy).toBeNull();
  });
});

describe("passesAccuracy", () => {
  it("ALL keeps everything, including entries whose accuracy can't be computed", () => {
    expect(passesAccuracy({ allianceAccuracy: null }, null)).toBe(true);
    expect(passesAccuracy({ allianceAccuracy: 12 }, null)).toBe(true);
  });

  it("a threshold keeps only computable entries at or above it", () => {
    expect(passesAccuracy({ allianceAccuracy: null }, 75)).toBe(false);
    expect(passesAccuracy({ allianceAccuracy: 74 }, 75)).toBe(false);
    expect(passesAccuracy({ allianceAccuracy: 75 }, 75)).toBe(true);
    expect(passesAccuracy({ allianceAccuracy: 99 }, 75)).toBe(true);
  });

  it("compares the displayed whole percent, so 74.6% shown as 75% passes 75", () => {
    expect(passesAccuracy({ allianceAccuracy: 74.6 }, 75)).toBe(true);
    expect(passesAccuracy({ allianceAccuracy: 74.4 }, 75)).toBe(false);
  });
});

describe("selectAnalyticsEntries", () => {
  const entries = [
    entry("hi", { accuracy: complete(95), eventCode: "EVT1" }),
    entry("lo", { accuracy: complete(60), eventCode: "EVT1", teamNumber: 200 }),
    entry("unknown", { eventCode: "EVT1", teamNumber: 300 }),
    entry("excluded", { accuracy: complete(99), excluded: true, eventCode: "EVT1" }),
    entry("other-event", { accuracy: complete(95), eventCode: "EVT2" }),
    entry("old-game", { formId: "retired", eventCode: "EVT1" }),
    entry("prac", { source: "practice", mode: "trial", sessionId: "s1", eventCode: "LIB1" }),
    entry("prac-comp", { source: "practice", mode: "competitive", sessionId: "s2", eventCode: "LIB1" }),
    entry("live", { source: "live", sessionId: "s3", eventCode: "LIB2" }),
  ];
  const sessionsById = new Map<string, SessionAccuracy>([
    ["s1", session(80)],
    ["s2", session(50)],
    ["s3", session(null)],
  ]);
  const ids = (list: { id: string }[]) => list.map((e) => e.id).sort();
  const run = (f: AnalyticsFilters, opts = {}, active = ["EVT1"]) => selectAnalyticsEntries({ entries, sessionsById, filters: f, activeEventCodes: active }, opts);

  it("ALL: every non-excluded entry in the active events, including uncomputable accuracy", () => {
    const { scope, used } = run(filters());
    expect(ids(scope)).toEqual(["excluded", "hi", "lo", "unknown"]);
    expect(ids(used)).toEqual(["hi", "lo", "unknown"]);
  });

  it("excluded entries are always ignored, even at ALL and even with a passing accuracy", () => {
    expect(ids(run(filters({ accuracy: 90 })).used)).toEqual(["hi"]);
    expect(ids(run(filters()).used)).not.toContain("excluded");
  });

  it("a threshold drops uncomputable and low-accuracy entries", () => {
    expect(ids(run(filters({ accuracy: 75 })).used)).toEqual(["hi"]);
    expect(ids(run(filters({ accuracy: 50 })).used)).toEqual(["hi", "lo"]);
  });

  it("event scope: all, custom, and active", () => {
    expect(ids(run(filters({ events: { kind: "all" } })).used)).toEqual(["hi", "lo", "other-event", "unknown"]);
    expect(ids(run(filters({ events: { kind: "custom", codes: ["EVT2"] } })).used)).toEqual(["other-event"]);
    expect(run(filters(), {}, []).used).toEqual([]);
  });

  it("ignores entries from another game", () => {
    expect(ids(run(filters({ events: { kind: "all" } })).scope)).not.toContain("old-game");
  });

  it("practice mode switches to practice + live data and ignores the active events", () => {
    const both = run(filters({ practice: true })).used;
    expect(ids(both)).toEqual(["live", "prac", "prac-comp"]);
    expect(ids(run(filters({ practice: true, practiceMode: "trial" })).used)).toEqual(["prac"]);
    expect(ids(run(filters({ practice: true, practiceMode: "competitive" })).used)).toEqual(["prac-comp"]);
    expect(ids(run(filters({ practice: true, practiceSource: "live" })).used)).toEqual(["live"]);
    expect(ids(run(filters({ practice: true, practiceSource: "practice" })).used)).toEqual(["prac", "prac-comp"]);
  });

  it("applies the accuracy filter to practice entries by their session's accuracy", () => {
    expect(ids(run(filters({ practice: true, accuracy: 75 })).used)).toEqual(["prac"]);
  });

  it("practice event filter uses the library event code", () => {
    expect(ids(run(filters({ practice: true, events: { kind: "custom", codes: ["LIB2"] } })).used)).toEqual(["live"]);
  });

  it("the raw view keeps excluded entries and skips the accuracy filter", () => {
    const { used } = run(filters({ accuracy: 90 }), { applyAccuracy: false, includeExcluded: true });
    expect(ids(used)).toEqual(["excluded", "hi", "lo", "unknown"]);
  });

  it("an excluded practice session removes its entries", () => {
    const withExcluded = new Map(sessionsById).set("s1", session(80, true));
    const { used } = selectAnalyticsEntries({ entries, sessionsById: withExcluded, filters: filters({ practice: true }), activeEventCodes: [] });
    expect(ids(used)).not.toContain("prac");
  });
});
