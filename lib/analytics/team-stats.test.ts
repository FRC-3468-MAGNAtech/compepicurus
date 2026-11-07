import { describe, expect, it } from "vitest";
import { initialScoutEntryFields, type ScoutEntry, type ScoutEntryFields } from "@/lib/scout-entries";
import { BIOBUZZ_FORM_SCHEMA, calculateScore, type ScoutFormSchema } from "@/lib/scout-form/schema";
import { fromLegacySchema } from "@/lib/forms/legacy";
import type { AnalyticsEntry } from "./entries";
import {
  DEFAULT_MIN_ENTRIES,
  buildAllTeamStats,
  buildTeamStats,
  consistencyOf,
  lowSample,
  rankTeams,
  type TeamStats,
} from "./team-stats";

let counter = 0;
/** A scored entry built through the real schema, so `score` and `fields` always agree. */
function entry(teamNumber: number, fields: Partial<ScoutEntryFields>, over: Partial<AnalyticsEntry> = {}): AnalyticsEntry {
  counter += 1;
  const full = { ...initialScoutEntryFields, ...fields };
  const score = calculateScore(BIOBUZZ_FORM_SCHEMA, full as unknown as Record<string, boolean | number>);
  const base: ScoutEntry = {
    id: `e${counter}`,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "Scout",
    eventCode: "EVT1",
    matchType: "Qualification",
    matchNumber: counter,
    teamNumber,
    fields: full,
    score,
    comments: "",
    submittedAt: `2026-01-01T00:00:${String(counter).padStart(2, "0")}.000Z`,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
  };
  return { ...base, allianceAccuracy: null, isExcluded: false, ...over };
}

describe("consistencyOf", () => {
  it("is 100 minus the coefficient of variation, clamped to 0-100", () => {
    expect(consistencyOf(100, 0)).toBe(100);
    expect(consistencyOf(100, 25)).toBe(75);
    expect(consistencyOf(10, 50)).toBe(0);
    expect(consistencyOf(0, 0)).toBe(100);
    expect(consistencyOf(0, 3)).toBe(0);
  });
});

describe("buildTeamStats", () => {
  // Scores: 3 (leave) | 3+5+20 = 28 | 20 (tele hive) + 5 + 2*3 = 31... computed below via the schema.
  const e1 = entry(100, { autoLeave: true }); //                       auto 3  total 3
  const e2 = entry(100, { autoLeave: true, autoPark: true, autoTipHive: 1 }); // auto 28 total 28
  const e3 = entry(100, { teleTipHive: 1, flowerBottomNectar: true, flowerPollenNectar: 3, endgamePark: true, diedDuringMatch: true });
  // e3: teleop 20+5+6 = 31, endgame 5, total 36

  it("computes the score summary", () => {
    const s = buildTeamStats([e1, e2, e3], BIOBUZZ_FORM_SCHEMA);
    expect(s.teamNumber).toBe(100);
    expect(s.entryCount).toBe(3);
    expect([e1.score.total, e2.score.total, e3.score.total]).toEqual([3, 28, 36]);
    expect(s.avgTotal).toBeCloseTo(67 / 3);
    expect(s.medianTotal).toBe(28);
    expect(s.highTotal).toBe(36);
    expect(s.lowTotal).toBe(3);
    // sample std dev of 3, 28, 36
    const m = 67 / 3;
    expect(s.stdDev).toBeCloseTo(Math.sqrt(((3 - m) ** 2 + (28 - m) ** 2 + (36 - m) ** 2) / 2));
    expect(s.consistency).toBeCloseTo(Math.max(0, 100 - (s.stdDev / s.avgTotal) * 100));
    expect(s.avgAuto).toBeCloseTo((3 + 28 + 0) / 3);
    expect(s.avgTeleop).toBeCloseTo(31 / 3);
    expect(s.avgEndgame).toBeCloseTo(5 / 3);
  });

  it("median of an even count is the mean of the middle two", () => {
    const s = buildTeamStats([e1, e2, e3, entry(100, { autoLeave: true, autoPark: true })], BIOBUZZ_FORM_SCHEMA);
    expect(s.medianTotal).toBe((8 + 28) / 2);
  });

  it("has per-field stats for every scoring and checkbox field: counters avg/high, toggles rate", () => {
    const s = buildTeamStats([e1, e2, e3], BIOBUZZ_FORM_SCHEMA);
    expect(s.fieldStats.autoTipHive).toMatchObject({ type: "counter", high: 1, rate: null });
    expect(s.fieldStats.autoTipHive.avg).toBeCloseTo(1 / 3);
    expect(s.fieldStats.autoTipHive.avgPoints).toBeCloseTo(20 / 3);
    expect(s.fieldStats.flowerPollenNectar).toMatchObject({ high: 3, sectionId: "teleop", groupLabel: "Flower" });
    expect(s.fieldStats.autoLeave).toMatchObject({ type: "toggle", avg: null, high: null });
    expect(s.fieldStats.autoLeave.rate).toBeCloseTo((2 / 3) * 100);
    expect(s.fieldStats.autoLeave.avgPoints).toBeCloseTo((2 / 3) * 3);
    expect(Object.keys(s.fieldStats)).not.toContain("comments");
  });

  it("reports incident rates for the General checkboxes only", () => {
    const s = buildTeamStats([e1, e2, e3], BIOBUZZ_FORM_SCHEMA);
    expect(s.incidentRates.diedDuringMatch).toBeCloseTo(100 / 3);
    expect(s.incidentRates.redCard).toBe(0);
    expect(Object.keys(s.incidentRates).sort()).toEqual(
      ["diedDuringMatch", "disabledByFtc", "neverStartedMatch", "recoveredFromFreeze", "redCard", "tippedOver", "yellowCard"].sort()
    );
  });

  it("reliability is the share of entries with none of the schema's reliability incidents", () => {
    // e3 died. e1/e2 clean. A tipped-over + yellow-card entry: tipped counts, the card does not.
    const tipped = entry(100, { tippedOver: true, yellowCard: true });
    const card = entry(100, { redCard: true });
    expect(buildTeamStats([e1, e2, e3], BIOBUZZ_FORM_SCHEMA).reliability).toBeCloseTo((2 / 3) * 100);
    expect(buildTeamStats([tipped, card], BIOBUZZ_FORM_SCHEMA).reliability).toBe(50);
  });

  it("counts an entry with several reliability incidents once", () => {
    const both = entry(100, { diedDuringMatch: true, tippedOver: true });
    expect(buildTeamStats([both, entry(100, {})], BIOBUZZ_FORM_SCHEMA).reliability).toBe(50);
  });

  it("reliability is null with no entries, or when the schema flags no reliability fields", () => {
    expect(buildTeamStats([], BIOBUZZ_FORM_SCHEMA, { teamNumber: 1 }).reliability).toBeNull();
  });

  it("groups points by game element across phases, and the shares add to 1", () => {
    const s = buildTeamStats([e1, e2, e3], BIOBUZZ_FORM_SCHEMA);
    const hive = s.elementBreakdown.find((x) => x.element === "Hive")!;
    // Hive = autoTipHive (1x20 over 3 entries) + teleTipHive (1x20 over 3 entries)
    expect(hive.avgPoints).toBeCloseTo(40 / 3);
    expect(s.elementBreakdown.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
    // Park appears in both Autonomous and Endgame but is one element.
    expect(s.elementBreakdown.filter((x) => x.element === "Park")).toHaveLength(1);
    // Sorted by points, highest first.
    const pts = s.elementBreakdown.map((x) => x.avgPoints);
    expect([...pts].sort((a, b) => b - a)).toEqual(pts);
    // The elements' points add up to the average score.
    expect(s.elementBreakdown.reduce((a, x) => a + x.avgPoints, 0)).toBeCloseTo(s.avgTotal);
  });

  it("averages alliance accuracy over the entries that have one", () => {
    const s = buildTeamStats(
      [entry(100, {}, { allianceAccuracy: 80 }), entry(100, {}, { allianceAccuracy: 90 }), entry(100, {}, { allianceAccuracy: null })],
      BIOBUZZ_FORM_SCHEMA
    );
    expect(s.avgAccuracy).toBe(85);
    expect(buildTeamStats([entry(100, {})], BIOBUZZ_FORM_SCHEMA).avgAccuracy).toBeNull();
  });

  it("lists matches in match order with their scores", () => {
    const later = entry(100, {}, { matchNumber: 9 });
    const earlier = entry(100, { autoLeave: true }, { matchNumber: 2 });
    const practice = entry(100, {}, { matchType: "Practice", matchNumber: 7 });
    const s = buildTeamStats([later, earlier, practice], BIOBUZZ_FORM_SCHEMA);
    expect(s.matchesScouted.map((m) => m.label)).toEqual(["P7", "Q2", "Q9"]);
    expect(s.matchesScouted[1]).toMatchObject({ auto: 3, total: 3, entryId: earlier.id });
  });

  it("handles a single entry (std dev 0, consistency 100, no trend)", () => {
    const s = buildTeamStats([entry(7, { autoLeave: true })], BIOBUZZ_FORM_SCHEMA);
    expect(s.stdDev).toBe(0);
    expect(s.consistency).toBe(100);
    expect(s.trend.direction).toBeNull();
  });

  it("builds an empty result without NaN when there are no entries", () => {
    const s = buildTeamStats([], BIOBUZZ_FORM_SCHEMA, { teamNumber: 42, teamName: "Nobody" });
    expect(s).toMatchObject({ teamNumber: 42, teamName: "Nobody", entryCount: 0, avgTotal: 0, highTotal: 0, lowTotal: 0, stdDev: 0 });
    expect(Object.values(s).every((v) => typeof v !== "number" || Number.isFinite(v))).toBe(true);
    expect(s.fieldStats.autoTipHive.high).toBe(0);
  });

  describe("trend", () => {
    const series = (totals: number[]) =>
      totals.map((points) => entry(100, { flowerPollenNectar: points / 2 }, { submittedAt: `2026-02-01T00:00:${String(counter).padStart(2, "0")}.000Z` }));

    it("needs entries beyond the recent window", () => {
      expect(buildTeamStats(series([10, 10, 10]), BIOBUZZ_FORM_SCHEMA).trend.direction).toBeNull();
    });

    it("is up when recent matches beat the overall average, down when they trail it, flat otherwise", () => {
      expect(buildTeamStats(series([10, 10, 10, 40, 40, 40]), BIOBUZZ_FORM_SCHEMA).trend.direction).toBe("up");
      expect(buildTeamStats(series([40, 40, 40, 10, 10, 10]), BIOBUZZ_FORM_SCHEMA).trend.direction).toBe("down");
      expect(buildTeamStats(series([20, 20, 20, 20, 20, 20]), BIOBUZZ_FORM_SCHEMA).trend.direction).toBe("flat");
    });

    it("compares by submission time, not by the order entries were passed in", () => {
      const ordered = series([10, 10, 10, 40, 40, 40]);
      const shuffled = [ordered[4], ordered[0], ordered[5], ordered[2], ordered[3], ordered[1]];
      expect(buildTeamStats(shuffled, BIOBUZZ_FORM_SCHEMA).trend.direction).toBe("up");
    });
  });
});

describe("schema-driven", () => {
  // A season that shares no field names with BIOBUZZ.
  const OTHER: ScoutFormSchema = fromLegacySchema({
    id: "other",
    version: 1,
    name: "Other",
    sections: [
      { id: "autonomous", label: "Autonomous", fields: [{ key: "spin", type: "toggle", label: "Spin", points: 10, phase: "auto" }] },
      {
        id: "teleop",
        label: "Teleoperated",
        groups: [{ label: "Gears", fields: [{ key: "gears", type: "counter", label: "Gears", points: 4, phase: "teleop", element: "Gear" }] }],
      },
      { id: "general", label: "General", fields: [{ key: "stuck", type: "checkbox", label: "Got stuck" }, { key: "notes", type: "text", label: "Notes" }] },
    ],
  });

  it("builds stats for any schema without knowing its field names", () => {
    const e = (gears: number, spin: boolean, stuck: boolean): AnalyticsEntry => {
      const fields = { spin, gears, stuck } as unknown as ScoutEntryFields;
      const score = calculateScore(OTHER, fields as unknown as Record<string, boolean | number>);
      return { ...entry(5, {}), fields, score, allianceAccuracy: null };
    };
    const s = buildTeamStats([e(2, true, false), e(4, false, true)], OTHER);
    expect(s.avgTotal).toBe((18 + 16) / 2);
    expect(s.fieldStats.gears).toMatchObject({ avg: 3, high: 4 });
    expect(s.fieldStats.spin.rate).toBe(50);
    expect(s.incidentRates).toEqual({ stuck: 50 });
    expect(s.reliability).toBeNull(); // OTHER flags no reliability fields
    expect(s.elementBreakdown.map((x) => x.element).sort()).toEqual(["Gear", "Spin"]);
  });
});

describe("buildAllTeamStats", () => {
  it("groups by team, orders by team number, and attaches names", () => {
    const stats = buildAllTeamStats([entry(300, {}), entry(100, {}), entry(300, {})], BIOBUZZ_FORM_SCHEMA, new Map([[100, "Alpha"]]));
    expect(stats.map((s) => [s.teamNumber, s.entryCount, s.teamName])).toEqual([
      [100, 1, "Alpha"],
      [300, 2, null],
    ]);
  });
});

describe("rankTeams", () => {
  const team = (teamNumber: number, totals: number[]): TeamStats =>
    buildTeamStats(
      totals.map((t) => entry(teamNumber, { flowerPollenNectar: t / 2 })),
      BIOBUZZ_FORM_SCHEMA
    );

  it("ranks by the metric with ties sharing a rank (1, 2, 2, 4)", () => {
    const ranked = rankTeams([team(1, [10, 10]), team(2, [20, 20]), team(3, [20, 20]), team(4, [30, 30])], "avgTotal");
    expect(ranked.map((r) => [r.stats.teamNumber, r.rank])).toEqual([
      [4, 1],
      [2, 2],
      [3, 2],
      [1, 4],
    ]);
  });

  it("ranks by any metric", () => {
    const a = team(1, [10, 50]); // avg 30, high 50, erratic
    const b = team(2, [29, 31]); // avg 30, high 31, steady
    const teams = [a, b];
    expect(rankTeams(teams, "highTotal")[0].stats.teamNumber).toBe(1);
    expect(rankTeams(teams, "consistency")[0].stats.teamNumber).toBe(2);
  });

  it("lists low-sample teams after every ranked team, flagged and unranked", () => {
    const ranked = rankTeams([team(1, [90]), team(2, [10, 10]), team(3, [20, 20]), team(4, [80])], "avgTotal");
    expect(ranked.map((r) => r.stats.teamNumber)).toEqual([3, 2, 1, 4]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, null, null]);
    expect(ranked.map((r) => r.lowSample)).toEqual([false, false, true, true]);
  });

  it("honors the minimum-entries control", () => {
    const teams = [team(1, [90]), team(2, [10, 10])];
    expect(rankTeams(teams, "avgTotal", 1).map((r) => r.rank)).toEqual([1, 2]);
    expect(rankTeams(teams, "avgTotal", 3).map((r) => r.rank)).toEqual([null, null]);
  });

  it("treats float-noise differences as ties", () => {
    const a = team(1, [10, 10]);
    const b = { ...team(2, [10, 10]), avgTotal: a.avgTotal + 1e-12 };
    expect(rankTeams([a, b], "avgTotal").map((r) => r.rank)).toEqual([1, 1]);
  });

  it("returns an empty list for no teams", () => {
    expect(rankTeams([], "avgTotal")).toEqual([]);
  });
});

describe("lowSample", () => {
  it("is true below the minimum (default 2)", () => {
    expect(DEFAULT_MIN_ENTRIES).toBe(2);
    expect(lowSample({ entryCount: 1 })).toBe(true);
    expect(lowSample({ entryCount: 2 })).toBe(false);
    expect(lowSample({ entryCount: 4 }, 5)).toBe(true);
  });
});
