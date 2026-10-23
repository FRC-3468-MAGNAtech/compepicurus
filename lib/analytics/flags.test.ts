import { describe, expect, it } from "vitest";
import { evaluateAutoFlagRuleIds, FLAG_THRESHOLDS, type FlagContext } from "@/lib/analytics/flags";
import { initialScoutEntryFields, type ScoutEntry } from "@/lib/scout-entries";
import type { FtcMatch } from "@/lib/ftc/types";

const stubMatch: FtcMatch = {
  id: "EVENT1-Qualification-1",
  type: "Qualification",
  matchNumber: 1,
  description: null,
  series: 1,
  redTeams: [300, 400],
  blueTeams: [500, 600],
  redScore: 150,
  blueScore: 120,
  redPenaltyPoints: 0,
  bluePenaltyPoints: 0,
  played: true,
  startTime: null,
};

function makeEntry(overrides: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id: "entry-1",
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
    teamNumber: 100,
    fields: initialScoutEntryFields,
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: new Date().toISOString(),
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    ...overrides,
  };
}

const emptyContext: FlagContext = {
  match: null,
  allianceTeams: [],
  officialAllianceScore: null,
  allianceAccuracy: null,
  sameMatchEntries: [],
  sameTeamEntries: [],
};

describe("evaluateAutoFlagRuleIds", () => {
  it("flags zero scoring unless the robot never started or died", () => {
    expect(evaluateAutoFlagRuleIds(makeEntry(), emptyContext)).toContain("zero-main-scoring");
    expect(evaluateAutoFlagRuleIds(makeEntry({ fields: { ...initialScoutEntryFields, neverStartedMatch: true } }), emptyContext)).not.toContain(
      "zero-main-scoring"
    );
  });

  it("flags an auto tip hive count above the threshold", () => {
    const entry = makeEntry({
      fields: { ...initialScoutEntryFields, autoTipHive: FLAG_THRESHOLDS.UNREALISTIC_AUTO_TIP_HIVE + 1 },
      score: { auto: 100, teleop: 0, endgame: 0, total: 100 },
    });
    expect(evaluateAutoFlagRuleIds(entry, emptyContext)).toContain("unrealistic-auto-scoring");
  });

  it("flags a score that exceeds the alliance's official score", () => {
    const entry = makeEntry({ score: { auto: 0, teleop: 200, endgame: 0, total: 200 } });
    const ctx: FlagContext = { ...emptyContext, officialAllianceScore: 150 };
    expect(evaluateAutoFlagRuleIds(entry, ctx)).toContain("exceeds-alliance-score");
  });

  it("flags never-started-but-scored", () => {
    const entry = makeEntry({
      fields: { ...initialScoutEntryFields, neverStartedMatch: true },
      score: { auto: 20, teleop: 0, endgame: 0, total: 20 },
    });
    expect(evaluateAutoFlagRuleIds(entry, emptyContext)).toContain("never-started-but-scored");
  });

  it("flags contradictory incidents", () => {
    const entry = makeEntry({
      fields: { ...initialScoutEntryFields, neverStartedMatch: true, recoveredFromFreeze: true },
    });
    expect(evaluateAutoFlagRuleIds(entry, emptyContext)).toContain("contradictory-incidents");
  });

  it("flags a team that isn't on the official match roster", () => {
    const entry = makeEntry();
    const ctx: FlagContext = { ...emptyContext, match: stubMatch, allianceTeams: [] };
    expect(evaluateAutoFlagRuleIds(entry, ctx)).toContain("team-not-in-match");
  });

  it("flags duplicate entries for the same match and team", () => {
    const entry = makeEntry();
    const dup = makeEntry({ id: "entry-2" });
    const ctx: FlagContext = { ...emptyContext, sameMatchEntries: [dup] };
    expect(evaluateAutoFlagRuleIds(entry, ctx)).toContain("duplicate-entry");
  });

  it("flags the same scout logging more than one robot in a match", () => {
    const entry = makeEntry({ teamNumber: 100 });
    const other = makeEntry({ id: "entry-2", teamNumber: 200, scoutName: entry.scoutName });
    const ctx: FlagContext = { ...emptyContext, sameMatchEntries: [other] };
    expect(evaluateAutoFlagRuleIds(entry, ctx)).toContain("scout-logged-multiple-robots");
  });

  it("flags a statistical outlier against the team's own history", () => {
    const history = [0, 10, 12, 8, 11].map((total, i) =>
      makeEntry({ id: `hist-${i}`, score: { auto: 0, teleop: 0, endgame: 0, total } })
    );
    const outlier = makeEntry({ score: { auto: 0, teleop: 0, endgame: 0, total: 500 } });
    const ctx: FlagContext = { ...emptyContext, sameTeamEntries: history };
    expect(evaluateAutoFlagRuleIds(outlier, ctx)).toContain("statistical-outlier");
  });

  it("does not flag a statistical outlier without enough history", () => {
    const history = [0, 10].map((total, i) => makeEntry({ id: `hist-${i}`, score: { auto: 0, teleop: 0, endgame: 0, total } }));
    const outlier = makeEntry({ score: { auto: 0, teleop: 0, endgame: 0, total: 500 } });
    const ctx: FlagContext = { ...emptyContext, sameTeamEntries: history };
    expect(evaluateAutoFlagRuleIds(outlier, ctx)).not.toContain("statistical-outlier");
  });

  it("flags low alliance accuracy", () => {
    const entry = makeEntry();
    const ctx: FlagContext = {
      ...emptyContext,
      allianceAccuracy: { status: "complete", value: 0.3, scoutedTotal: 50, penaltyPoints: 0, officialScore: 150 },
    };
    expect(evaluateAutoFlagRuleIds(entry, ctx)).toContain("low-alliance-accuracy");
  });

  it("produces no flags for a clean, typical entry", () => {
    const entry = makeEntry({ score: { auto: 20, teleop: 40, endgame: 5, total: 65 } });
    const ctx: FlagContext = { ...emptyContext, officialAllianceScore: 150 };
    expect(evaluateAutoFlagRuleIds(entry, ctx)).toEqual([]);
  });
});
