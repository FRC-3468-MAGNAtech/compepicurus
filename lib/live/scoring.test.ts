import { describe, expect, it } from "vitest";
import type { FtcMatch } from "@/lib/ftc/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import { resolveLiveAllianceScoring } from "./scoring";

function match(overrides: Partial<FtcMatch> = {}): FtcMatch {
  return {
    id: "m1",
    matchNumber: 1,
    type: "Qualification",
    description: null,
    series: null,
    played: true,
    redTeams: [100, 200],
    blueTeams: [300, 400],
    redScore: 100,
    blueScore: 50,
    redPenaltyPoints: 0,
    bluePenaltyPoints: 0,
    startTime: null,
    ...overrides,
  };
}

function entry(overrides: Partial<ScoutEntry> & { id: string; teamNumber: number; total: number }): ScoutEntry {
  return {
    teamId: "team1",
    uid: overrides.id,
    source: "live",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: overrides.id,
    eventCode: "USWABON1",
    matchType: "Qualification",
    matchNumber: 1,
    fields: {} as ScoutEntry["fields"],
    score: { auto: 0, teleop: 0, endgame: 0, total: overrides.total },
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

describe("resolveLiveAllianceScoring", () => {
  it("returns null when the official score hasn't posted", () => {
    const m = match({ redScore: null });
    const entries: [ScoutEntry, ScoutEntry] = [
      entry({ id: "e1", teamNumber: 100, total: 50 }),
      entry({ id: "e2", teamNumber: 200, total: 50 }),
    ];
    expect(resolveLiveAllianceScoring(m, "red", entries)).toBeNull();
  });

  it("computes accuracy and writes it in both the 0-1 (entry) and 0-100 (session) scales", () => {
    const m = match();
    const entries: [ScoutEntry, ScoutEntry] = [
      entry({ id: "e1", teamNumber: 100, total: 50 }),
      entry({ id: "e2", teamNumber: 200, total: 50 }),
    ];
    const result = resolveLiveAllianceScoring(m, "red", entries);
    expect(result).not.toBeNull();
    expect(result!.sessionAccuracy).toBeCloseTo(100, 5);
    expect(result!.entryAccuracy.status).toBe("complete");
    expect(result!.entryAccuracy.value).toBeCloseTo(1, 5);
    expect(result!.sessionOfficialScore).toBe(100);
  });

  it("flags Zero Entries when both robots scored nothing", () => {
    const m = match({ redScore: 0 });
    const entries: [ScoutEntry, ScoutEntry] = [
      entry({ id: "e1", teamNumber: 100, total: 0 }),
      entry({ id: "e2", teamNumber: 200, total: 0 }),
    ];
    const result = resolveLiveAllianceScoring(m, "red", entries);
    expect(result!.sessionFlags.some((f) => f.type === "zero-entries")).toBe(true);
  });

  it("preserves a previously-dismissed auto-flag on re-resolution", () => {
    const m = match();
    const entries: [ScoutEntry, ScoutEntry] = [
      entry({ id: "e1", teamNumber: 100, total: 300, autoFlags: [{ ruleId: "unrealistic-teleop-scoring", dismissed: true }] }),
      entry({ id: "e2", teamNumber: 200, total: 50 }),
    ];
    const result = resolveLiveAllianceScoring(m, "red", entries);
    const e1Flags = result!.entryAutoFlags["e1"];
    const unrealistic = e1Flags.find((f) => f.ruleId === "unrealistic-teleop-scoring");
    expect(unrealistic?.dismissed).toBe(true);
  });
});
