import { describe, expect, it } from "vitest";
import { initialScoutEntryFields, type ScoutEntryFields } from "@/lib/scout-entries";
import { BIOBUZZ_FORM_SCHEMA, calculateScore, type ScoutFormSchema } from "@/lib/scout-form/schema";
import { fromLegacySchema } from "@/lib/forms/legacy";
import type { AnalyticsEntry } from "./entries";
import { buildKeyStats, reliabilityIncidents, reliabilityLevel, sortTeams, teamMatchesSearch } from "./team-card";
import { buildTeamStats } from "./team-stats";

let n = 0;
function entry(teamNumber: number, fields: Partial<ScoutEntryFields>): AnalyticsEntry {
  n += 1;
  const full = { ...initialScoutEntryFields, ...fields };
  return {
    id: `e${n}`,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "S",
    eventCode: "E",
    matchType: "Qualification",
    matchNumber: n,
    teamNumber,
    fields: full,
    score: calculateScore(BIOBUZZ_FORM_SCHEMA, full as unknown as Record<string, boolean | number>),
    comments: "",
    submittedAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    allianceAccuracy: null,
    isExcluded: false,
  };
}

describe("buildKeyStats", () => {
  const stats = buildTeamStats(
    [
      entry(1, { autoTipHive: 1, teleTipHive: 2, flowerPollenNectar: 4, gardenPollenNectar: 2, autoLeave: true, endgamePark: true }),
      entry(1, { autoTipHive: 0, teleTipHive: 1, flowerPollenNectar: 0, gardenPollenNectar: 2, flowerBottomNectar: true, autoPark: true }),
    ],
    BIOBUZZ_FORM_SCHEMA
  );
  const key = buildKeyStats(stats, BIOBUZZ_FORM_SCHEMA);

  it("sums counters by label across phases: Tip Hive = auto + teleop, Pollen and Nectar = flower + garden", () => {
    expect(key.counters.map((c) => c.label)).toEqual(["Tip Hive", "Pollen and Nectar"]);
    // (1 + 0)/2 + (2 + 1)/2
    expect(key.counters[0].avg).toBeCloseTo(2);
    // (4 + 0)/2 + (2 + 2)/2
    expect(key.counters[1].avg).toBeCloseTo(4);
  });

  it("lists each toggle's rate, adding the phase only where a label repeats", () => {
    expect(key.rates.map((r) => r.label)).toEqual(["Leave", "Park (auto)", "Bottom Nectar", "Park (endgame)"]);
    expect(Object.fromEntries(key.rates.map((r) => [r.label, r.rate]))).toEqual({
      Leave: 50,
      "Park (auto)": 50,
      "Bottom Nectar": 50,
      "Park (endgame)": 50,
    });
  });

  it("works for any schema", () => {
    const other: ScoutFormSchema = fromLegacySchema({
      id: "o",
      version: 1,
      name: "O",
      sections: [{ id: "teleop", label: "Teleop", fields: [{ key: "gears", type: "counter", label: "Gears", points: 3, phase: "teleop" }, { key: "spin", type: "toggle", label: "Spin", points: 1, phase: "teleop" }] }],
    });
    const e = { ...entry(2, {}), fields: { gears: 4, spin: true } as unknown as ScoutEntryFields };
    const k = buildKeyStats(buildTeamStats([e], other), other);
    expect(k).toEqual({ counters: [{ label: "Gears", avg: 4 }], rates: [{ label: "Spin", rate: 100 }] });
  });
});

describe("reliability", () => {
  it("maps the share of incident-free entries to a level", () => {
    expect(reliabilityLevel(null)).toBe("unknown");
    expect(reliabilityLevel(100)).toBe("reliable");
    expect(reliabilityLevel(90)).toBe("reliable");
    expect(reliabilityLevel(89.9)).toBe("some-issues");
    expect(reliabilityLevel(75)).toBe("some-issues");
    expect(reliabilityLevel(74.9)).toBe("unreliable");
    expect(reliabilityLevel(0)).toBe("unreliable");
  });

  it("lists only the reliability incidents the team had, worst first (cards are conduct, not reliability)", () => {
    const stats = buildTeamStats(
      [entry(1, { diedDuringMatch: true, yellowCard: true }), entry(1, { diedDuringMatch: true, tippedOver: true }), entry(1, { redCard: true }), entry(1, {})],
      BIOBUZZ_FORM_SCHEMA
    );
    expect(reliabilityIncidents(stats, BIOBUZZ_FORM_SCHEMA)).toEqual([
      { label: "Died During Match", rate: 50 },
      { label: "Tipped Over", rate: 25 },
    ]);
  });
});

describe("sortTeams / teamMatchesSearch", () => {
  const mk = (teamNumber: number, fields: Partial<ScoutEntryFields>[], name: string | null = null) =>
    buildTeamStats(fields.map((f) => entry(teamNumber, f)), BIOBUZZ_FORM_SCHEMA, { teamNumber, teamName: name });
  const teams = [
    mk(300, [{ autoLeave: true }]), // avg 3, 1 entry, reliability 100
    mk(100, [{ autoLeave: true, autoPark: true }, { autoLeave: true, autoPark: true }], "Alpha"), // avg 8, 2 entries
    mk(200, [{ teleTipHive: 1, diedDuringMatch: true }, { teleTipHive: 1 }, { teleTipHive: 1 }], "Beta"), // avg 20, 3 entries, reliability 66.7
  ];
  const order = (key: Parameters<typeof sortTeams>[1]) => sortTeams(teams, key).map((t) => t.teamNumber);

  it("sorts best first by each key", () => {
    expect(order("avgTotal")).toEqual([200, 100, 300]);
    expect(order("entryCount")).toEqual([200, 100, 300]);
    expect(order("reliability")).toEqual([100, 300, 200]);
    expect(order("teamNumber")).toEqual([100, 200, 300]);
  });

  it("breaks ties by team number and never mutates its input", () => {
    const tied = [mk(9, [{ autoLeave: true }]), mk(2, [{ autoLeave: true }])];
    expect(sortTeams(tied, "avgTotal").map((t) => t.teamNumber)).toEqual([2, 9]);
    expect(tied.map((t) => t.teamNumber)).toEqual([9, 2]);
  });

  it("puts teams without a reliability value last", () => {
    const unknown = { ...mk(1, [{}]), reliability: null };
    expect(sortTeams([unknown, ...teams], "reliability").map((t) => t.teamNumber)).toEqual([100, 300, 200, 1]);
  });

  it("searches team number or name, case-insensitively", () => {
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: "MAGNAtech" }, "")).toBe(true);
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: "MAGNAtech" }, "346")).toBe(true);
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: "MAGNAtech" }, "magna")).toBe(true);
    expect(teamMatchesSearch({ teamNumber: 3468, teamName: null }, "magna")).toBe(false);
  });
});
