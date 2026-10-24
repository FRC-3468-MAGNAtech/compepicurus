import { describe, expect, it } from "vitest";
import { allianceForTeam, computeAllianceAccuracy } from "@/lib/analytics/accuracy";
import { initialScoutEntryFields, type ScoutEntry } from "@/lib/scout-entries";
import type { FtcMatch } from "@/lib/ftc/types";

function makeEntry(overrides: Partial<ScoutEntry> & Pick<ScoutEntry, "teamNumber">): ScoutEntry {
  return {
    id: `entry-${overrides.teamNumber}`,
    teamId: "default",
    uid: "uid-1",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "Test Scout",
    eventCode: "EVENT1",
    matchType: "Qualification",
    matchNumber: 1,
    fields: initialScoutEntryFields,
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: new Date().toISOString(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...overrides,
  };
}

const match: FtcMatch = {
  id: "EVENT1-Qualification-1",
  type: "Qualification",
  matchNumber: 1,
  description: null,
  series: 1,
  redTeams: [100, 200],
  blueTeams: [300, 400],
  redScore: 150,
  blueScore: 120,
  redPenaltyPoints: 0,
  bluePenaltyPoints: 0,
  played: true,
  startTime: null,
};

describe("allianceForTeam", () => {
  it("identifies the red alliance", () => {
    expect(allianceForTeam(match, 100)).toBe("red");
  });
  it("identifies the blue alliance", () => {
    expect(allianceForTeam(match, 400)).toBe("blue");
  });
  it("returns null for a team not on the match", () => {
    expect(allianceForTeam(match, 999)).toBeNull();
  });
});

describe("computeAllianceAccuracy", () => {
  it("needs both alliance robots scouted before producing a number", () => {
    const result = computeAllianceAccuracy([100, 200], 150, 0, [makeEntry({ teamNumber: 100, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } })]);
    expect(result.status).toBe("needs-robots");
    expect(result.value).toBeNull();
  });

  it("is awaiting results when the official score isn't in yet", () => {
    const entries = [
      makeEntry({ teamNumber: 100, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } }),
      makeEntry({ teamNumber: 200, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } }),
    ];
    const result = computeAllianceAccuracy([100, 200], null, 0, entries);
    expect(result.status).toBe("awaiting-results");
  });

  it("is perfectly accurate when scouted totals plus penalties match the official score exactly", () => {
    const entries = [
      makeEntry({ teamNumber: 100, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } }),
      makeEntry({ teamNumber: 200, score: { auto: 70, teleop: 0, endgame: 5, total: 75 } }),
    ];
    const result = computeAllianceAccuracy([100, 200], 150, 0, entries);
    expect(result.status).toBe("complete");
    expect(result.value).toBe(1);
    expect(result.scoutedTotal).toBe(150);
  });

  it("degrades accuracy proportionally to the gap between scouted and official scores", () => {
    const entries = [
      makeEntry({ teamNumber: 100, score: { auto: 50, teleop: 0, endgame: 0, total: 50 } }),
      makeEntry({ teamNumber: 200, score: { auto: 50, teleop: 0, endgame: 0, total: 50 } }),
    ];
    // scoutedTotal = 100, official = 150 -> |150-100|/150 = 1/3 off
    const result = computeAllianceAccuracy([100, 200], 150, 0, entries);
    expect(result.value).toBeCloseTo(2 / 3, 5);
  });

  it("treats a zero official score as perfect only when the scouted total is also zero", () => {
    const entries = [
      makeEntry({ teamNumber: 100, score: { auto: 0, teleop: 0, endgame: 0, total: 0 } }),
      makeEntry({ teamNumber: 200, score: { auto: 0, teleop: 0, endgame: 0, total: 0 } }),
    ];
    expect(computeAllianceAccuracy([100, 200], 0, 0, entries).value).toBe(1);

    const nonZero = [
      makeEntry({ teamNumber: 100, score: { auto: 5, teleop: 0, endgame: 0, total: 5 } }),
      makeEntry({ teamNumber: 200, score: { auto: 0, teleop: 0, endgame: 0, total: 0 } }),
    ];
    expect(computeAllianceAccuracy([100, 200], 0, 0, nonZero).value).toBe(0);
  });

  it("ignores excluded entries and falls back to needs-robots", () => {
    const entries = [
      makeEntry({ teamNumber: 100, excluded: true, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } }),
      makeEntry({ teamNumber: 200, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } }),
    ];
    expect(computeAllianceAccuracy([100, 200], 150, 0, entries).status).toBe("needs-robots");
  });

  it("uses the most recently submitted entry when a team has duplicates", () => {
    const older = makeEntry({ teamNumber: 100, submittedAt: "2026-01-01T00:00:00.000Z", score: { auto: 0, teleop: 0, endgame: 0, total: 0 } });
    const newer = makeEntry({ teamNumber: 100, submittedAt: "2026-01-02T00:00:00.000Z", score: { auto: 75, teleop: 0, endgame: 0, total: 75 } });
    const partner = makeEntry({ teamNumber: 200, score: { auto: 75, teleop: 0, endgame: 0, total: 75 } });
    const result = computeAllianceAccuracy([100, 200], 150, 0, [older, newer, partner]);
    expect(result.value).toBe(1);
  });
});
