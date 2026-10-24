import { describe, expect, it } from "vitest";
import { evaluatePracticeSessionFlags, PRACTICE_FLAG_THRESHOLDS } from "@/lib/practice-flags";
import { initialScoutEntryFields, type ScoutEntry } from "@/lib/scout-entries";

function makeEntry(overrides: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id: "entry-1",
    teamId: "team-1",
    uid: "uid-1",
    source: "practice",
    mode: "trial",
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "Test Scout",
    eventCode: "USWABON1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 100,
    fields: initialScoutEntryFields,
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: new Date().toISOString(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: "PS-ABCDEF",
    libraryMatchId: "USWABON1_Q1",
    ...overrides,
  };
}

describe("evaluatePracticeSessionFlags", () => {
  it("flags Zero Entries only when both entries score zero", () => {
    const zero = makeEntry();
    const nonZero = makeEntry({ score: { auto: 20, teleop: 0, endgame: 0, total: 20 } });

    const bothZero = evaluatePracticeSessionFlags({
      entries: [zero, zero],
      mode: "trial",
      videoProgressAtFinish: null,
      priorCompletedAttempt: false,
    });
    expect(bothZero.map((f) => f.type)).toContain("zero-entries");

    const oneNonZero = evaluatePracticeSessionFlags({
      entries: [zero, nonZero],
      mode: "trial",
      videoProgressAtFinish: null,
      priorCompletedAttempt: false,
    });
    expect(oneNonZero.map((f) => f.type)).not.toContain("zero-entries");
  });

  it("flags Unrealistic Entry when either entry trips Match Analytics' unrealistic-scoring rules", () => {
    const unrealistic = makeEntry({
      fields: { ...initialScoutEntryFields, autoTipHive: 10 },
      score: { auto: 200, teleop: 0, endgame: 0, total: 200 },
    });
    const normal = makeEntry({ score: { auto: 20, teleop: 40, endgame: 5, total: 65 } });

    const result = evaluatePracticeSessionFlags({
      entries: [unrealistic, normal],
      mode: "trial",
      videoProgressAtFinish: null,
      priorCompletedAttempt: false,
    });
    expect(result.map((f) => f.type)).toContain("unrealistic-entry");
  });

  it("does not flag Unrealistic Entry for ordinary scores", () => {
    const normal = makeEntry({ score: { auto: 20, teleop: 40, endgame: 5, total: 65 } });
    const result = evaluatePracticeSessionFlags({
      entries: [normal, normal],
      mode: "trial",
      videoProgressAtFinish: null,
      priorCompletedAttempt: false,
    });
    expect(result.map((f) => f.type)).not.toContain("unrealistic-entry");
  });

  it("flags Finished Early only in competitive mode, below the threshold", () => {
    const entry = makeEntry({ score: { auto: 20, teleop: 40, endgame: 5, total: 65 } });

    const earlyCompetitive = evaluatePracticeSessionFlags({
      entries: [entry, entry],
      mode: "competitive",
      videoProgressAtFinish: 0.5,
      priorCompletedAttempt: false,
    });
    expect(earlyCompetitive.map((f) => f.type)).toContain("finished-early");

    const fullCompetitive = evaluatePracticeSessionFlags({
      entries: [entry, entry],
      mode: "competitive",
      videoProgressAtFinish: PRACTICE_FLAG_THRESHOLDS.FINISHED_EARLY_MIN_PROGRESS,
      priorCompletedAttempt: false,
    });
    expect(fullCompetitive.map((f) => f.type)).not.toContain("finished-early");

    const earlyTrial = evaluatePracticeSessionFlags({
      entries: [entry, entry],
      mode: "trial",
      videoProgressAtFinish: 0.1,
      priorCompletedAttempt: false,
    });
    expect(earlyTrial.map((f) => f.type)).not.toContain("finished-early");
  });

  it("flags Repeat Attempt when the caller says this uid already completed it before", () => {
    const entry = makeEntry({ score: { auto: 20, teleop: 40, endgame: 5, total: 65 } });
    const result = evaluatePracticeSessionFlags({
      entries: [entry, entry],
      mode: "trial",
      videoProgressAtFinish: null,
      priorCompletedAttempt: true,
    });
    expect(result.map((f) => f.type)).toContain("repeat-attempt");
  });

  it("produces no flags for a clean, first-time, fully-watched session", () => {
    const entry = makeEntry({ score: { auto: 20, teleop: 40, endgame: 5, total: 65 } });
    const result = evaluatePracticeSessionFlags({
      entries: [entry, entry],
      mode: "competitive",
      videoProgressAtFinish: 1,
      priorCompletedAttempt: false,
    });
    expect(result).toEqual([]);
  });
});
