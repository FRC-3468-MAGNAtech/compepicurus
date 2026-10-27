import { describe, expect, it } from "vitest";
import type { LibraryMatch } from "@/lib/match-library";
import type { ScoutEntry } from "@/lib/scout-entries";
import { resolveLobbyPairScoring } from "./scoring";

function match(overrides: Partial<LibraryMatch["alliances"]["red"]> = {}): LibraryMatch {
  return {
    id: "USWABON1_Q1",
    seasonId: "biobuzz",
    eventCode: "USWABON1",
    eventName: "Rookie Rumble",
    matchType: "Qualification",
    matchNumber: 1,
    alliances: {
      red: { teams: [100, 200], score: 100, penaltyPoints: 0, difficulty: "medium", ...overrides },
      blue: { teams: [300, 400], score: 50, penaltyPoints: 0, difficulty: "easy" },
    },
    video: null,
    importedAt: "2026-01-01T00:00:00.000Z",
    scoresUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function entry(overrides: Partial<ScoutEntry> & { id: string; total: number }): ScoutEntry {
  return {
    teamId: "team1",
    uid: overrides.id,
    source: "practice",
    mode: "trial",
    formId: "biobuzz",
    formVersion: 1,
    scoutName: overrides.id,
    eventCode: "USWABON1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 100,
    fields: {} as ScoutEntry["fields"],
    score: { auto: 0, teleop: 0, endgame: 0, total: overrides.total },
    comments: "",
    submittedAt: "2026-01-01T00:00:00.000Z",
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: "USWABON1_Q1",
    ...overrides,
  };
}

describe("resolveLobbyPairScoring", () => {
  it("computes accuracy on the 0-100 scale against the library match's official score", () => {
    const m = match();
    const entries: [ScoutEntry, ScoutEntry] = [entry({ id: "e1", total: 50 }), entry({ id: "e2", total: 50 })];
    const result = resolveLobbyPairScoring(m, "red", entries, "trial", false);
    expect(result.accuracy).toBeCloseTo(100, 5);
    expect(result.scoutedTotal).toBe(100);
    expect(result.officialScore).toBe(100);
  });

  it("flags Zero Entries when both robots scored nothing", () => {
    const m = match({ score: 0 });
    const entries: [ScoutEntry, ScoutEntry] = [entry({ id: "e1", total: 0 }), entry({ id: "e2", total: 0 })];
    const result = resolveLobbyPairScoring(m, "red", entries, "trial", false);
    expect(result.flags.some((f) => f.type === "zero-entries")).toBe(true);
  });

  it("flags Repeat Attempt when told a prior attempt exists", () => {
    const m = match();
    const entries: [ScoutEntry, ScoutEntry] = [entry({ id: "e1", total: 50 }), entry({ id: "e2", total: 50 })];
    const result = resolveLobbyPairScoring(m, "red", entries, "trial", true);
    expect(result.flags.some((f) => f.type === "repeat-attempt")).toBe(true);
  });

  it("never flags Finished Early (no video-progress signal in lobby mode)", () => {
    const m = match();
    const entries: [ScoutEntry, ScoutEntry] = [entry({ id: "e1", total: 10 }), entry({ id: "e2", total: 10 })];
    const result = resolveLobbyPairScoring(m, "blue", entries, "competitive", false);
    expect(result.flags.some((f) => f.type === "finished-early")).toBe(false);
  });
});
