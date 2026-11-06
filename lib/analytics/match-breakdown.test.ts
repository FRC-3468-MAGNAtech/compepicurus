import { describe, expect, it } from "vitest";
import { initialScoutEntryFields, type ScoutEntryFields } from "@/lib/scout-entries";
import { BIOBUZZ_FORM_SCHEMA } from "@/lib/scout-form/schema";
import type { FtcMatch } from "@/lib/ftc/types";
import type { LibraryMatch } from "@/lib/match-library";
import type { AnalyticsEntry } from "./entries";
import {
  buildMatchBreakdowns,
  ftcMatchToOfficial,
  libraryMatchToOfficial,
  matchHasTeam,
  summarizeEntry,
  type OfficialMatch,
} from "./match-breakdown";

let n = 0;
function entry(teamNumber: number, total: number, over: Omit<Partial<AnalyticsEntry>, "fields"> & { fields?: Partial<ScoutEntryFields> } = {}): AnalyticsEntry {
  n += 1;
  const { fields, ...rest } = over;
  return {
    id: `e${n}`,
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
    teamNumber,
    fields: { ...initialScoutEntryFields, ...fields },
    score: { auto: 0, teleop: total, endgame: 0, total },
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
    ...rest,
  };
}

function official(over: Partial<OfficialMatch> = {}): OfficialMatch {
  return {
    eventCode: "EVT1",
    matchType: "Qualification",
    matchNumber: 1,
    played: true,
    red: { teams: [1, 2], score: 50, penaltyPoints: 0 },
    blue: { teams: [3, 4], score: 40, penaltyPoints: 0 },
    ...over,
  };
}

const run = (matches: OfficialMatch[], entries: AnalyticsEntry[], accuracyThreshold: number | null = null, practice = false) =>
  buildMatchBreakdowns({ matches, entries, accuracyThreshold, practice });

// Red scouts 25 + 25 = 50 vs official 50 (100%); blue 20 + 10 = 30 vs official 40 (75%).
const fullEntries = () => [entry(1, 25), entry(2, 25), entry(3, 20), entry(4, 10)];

describe("buildMatchBreakdowns: totals, accuracy, coverage", () => {
  it("sums scouted robot scores per alliance and computes accuracy with the shared engine", () => {
    const [m] = run([official()], fullEntries());
    expect(m.red.scoutedTotal).toBe(50);
    expect(m.blue.scoutedTotal).toBe(30);
    expect(m.red.accuracy).toBeCloseTo(100);
    expect(m.blue.accuracy).toBeCloseTo(75);
    expect(m.robotsScouted).toBe(4);
    expect(m.robotsTotal).toBe(4);
    expect(m.scouted).toBe(true);
    expect(m.label).toBe("Q1");
  });

  it("adds penalty points to the scouted side of the accuracy formula (the engine's rule), not to the displayed robot total", () => {
    // 20 + 20 = 40 robot points, +10 penalty = 50 vs official 50 -> 100% accuracy; the displayed total stays 40.
    const [m] = run([official({ red: { teams: [1, 2], score: 50, penaltyPoints: 10 } })], [entry(1, 20), entry(2, 20)]);
    expect(m.red.scoutedTotal).toBe(40);
    expect(m.red.accuracy).toBeCloseTo(100);
    expect(m.red.official).toEqual({ score: 50, penaltyPoints: 10 });
  });

  it("reports the official score without penalty points when none were awarded, and nothing when unavailable", () => {
    const [a] = run([official()], []);
    expect(a.red.official).toEqual({ score: 50, penaltyPoints: 0 });
    const [b] = run([official({ played: false, red: { teams: [1, 2], score: null, penaltyPoints: null }, blue: { teams: [3, 4], score: null, penaltyPoints: null } })], []);
    expect(b.red.official).toBeNull();
    expect(b.blue.official).toBeNull();
  });

  it("has no accuracy when a robot is unscouted, but still shows what was scouted at ALL", () => {
    const [m] = run([official()], [entry(1, 25), entry(3, 20), entry(4, 10)]);
    expect(m.red.accuracy).toBeNull();
    expect(m.red.visibility).toBe("shown");
    expect(m.red.scoutedTotal).toBe(25);
    expect(m.red.scoutedCount).toBe(1);
    expect(m.robotsScouted).toBe(3);
  });

  it("has no accuracy before the official score exists", () => {
    const [m] = run([official({ played: false, red: { teams: [1, 2], score: null, penaltyPoints: null }, blue: { teams: [3, 4], score: null, penaltyPoints: null } })], fullEntries());
    expect(m.red.accuracy).toBeNull();
    expect(m.red.scoutedTotal).toBe(50);
  });

  it("marks a match with no entries as not scouted", () => {
    const [m] = run([official()], []);
    expect(m.scouted).toBe(false);
    expect(m.red.visibility).toBe("not-scouted");
    expect(m.red.scoutedTotal).toBeNull();
    expect(m.robotsScouted).toBe(0);
    expect(m.redFraction).toBeNull();
  });

  it("uses a robot's latest entry when it was scouted more than once", () => {
    const older = entry(1, 5, { submittedAt: "2026-01-01T00:00:00.000Z" });
    const newer = entry(1, 25, { submittedAt: "2026-01-02T00:00:00.000Z" });
    const [m] = run([official()], [older, newer, entry(2, 25)]);
    expect(m.red.scoutedTotal).toBe(50);
  });

  it("keeps matches from different events apart", () => {
    const other = official({ eventCode: "EVT2" });
    const [a, b] = run([official(), other], fullEntries());
    expect(a.scouted).toBe(true);
    expect(b.scouted).toBe(false);
  });
});

describe("buildMatchBreakdowns: the accuracy filter", () => {
  it("ALL shows everything", () => {
    const [m] = run([official()], fullEntries(), null);
    expect(m.red.visibility).toBe("shown");
    expect(m.blue.visibility).toBe("shown");
  });

  it("withholds an alliance below the threshold: no numbers, a reason, but still counted as scouted", () => {
    const [m] = run([official()], fullEntries(), 85);
    expect(m.red.visibility).toBe("shown");
    expect(m.blue.visibility).toBe("below-accuracy");
    expect(m.blue.hiddenReason).toBe("Below accuracy filter (75%)");
    expect(m.blue.scoutedTotal).toBeNull();
    expect(m.blue.teams.every((t) => t.entry === null)).toBe(true);
    expect(m.blue.teams.every((t) => t.scouted)).toBe(true);
    expect(m.blue.scoutedCount).toBe(2);
    expect(m.robotsScouted).toBe(4);
    // Official numbers aren't scouted numbers — they stay.
    expect(m.blue.official).toEqual({ score: 40, penaltyPoints: 0 });
  });

  it("does not leak the withheld total through the bar", () => {
    const [m] = run([official()], fullEntries(), 85);
    expect(m.redFraction).toBeNull();
  });

  it("an alliance exactly at the threshold passes, comparing the displayed whole percent", () => {
    expect(run([official()], fullEntries(), 75)[0].blue.visibility).toBe("shown");
    // 74.6% displays as 75%.
    const m = official({ blue: { teams: [3, 4], score: 1000, penaltyPoints: 0 } });
    const entries = [entry(3, 400), entry(4, 346)]; // 746 / 1000
    expect(run([m], entries, 75)[0].blue.visibility).toBe("shown");
    expect(run([m], entries, 76)[0].blue.visibility).toBe("below-accuracy");
  });

  it("withholds an alliance whose accuracy can't be computed, with its own reason", () => {
    const [m] = run([official()], [entry(1, 25), entry(3, 20), entry(4, 10)], 75);
    expect(m.red.visibility).toBe("below-accuracy");
    expect(m.red.hiddenReason).toContain("can't be computed");
    expect(m.red.hiddenReason).toContain("75%");
    expect(m.red.scoutedTotal).toBeNull();
  });

  it("never marks an unscouted alliance as below-accuracy", () => {
    expect(run([official()], [], 90)[0].red.visibility).toBe("not-scouted");
  });
});

describe("buildMatchBreakdowns: bar and winner", () => {
  it("red fraction is red's share of the two scouted totals", () => {
    expect(run([official()], fullEntries())[0].redFraction).toBeCloseTo(50 / 80);
  });

  it("is an even split when both scouted totals are 0", () => {
    expect(run([official()], [entry(1, 0), entry(2, 0), entry(3, 0), entry(4, 0)])[0].redFraction).toBe(0.5);
  });

  it("is null unless both alliances are shown", () => {
    expect(run([official()], [entry(1, 25), entry(2, 25)])[0].redFraction).toBeNull();
  });

  it("the winner is the official one when the match is played and scored", () => {
    const [m] = run([official()], []);
    expect(m.winner).toBe("red");
    expect(m.winnerBasis).toBe("official");
    expect(run([official({ blue: { teams: [3, 4], score: 50, penaltyPoints: 0 } })], [])[0].winner).toBe("tie");
    expect(run([official({ red: { teams: [1, 2], score: 10, penaltyPoints: 0 } })], [])[0].winner).toBe("blue");
  });

  it("an official result wins out over scouted totals that disagree", () => {
    const entries = [entry(1, 1), entry(2, 1), entry(3, 50), entry(4, 50)];
    expect(run([official()], entries)[0].winner).toBe("red");
  });

  it("falls back to scouted totals only when the match has no official result and both alliances are fully scouted", () => {
    const unplayed = official({ played: false, red: { teams: [1, 2], score: null, penaltyPoints: null }, blue: { teams: [3, 4], score: null, penaltyPoints: null } });
    const full = run([unplayed], fullEntries())[0];
    expect(full.winner).toBe("red");
    expect(full.winnerBasis).toBe("scouted");
    expect(run([unplayed], [entry(1, 25), entry(2, 25), entry(3, 20)])[0].winner).toBeNull();
    expect(run([unplayed], [])[0].winner).toBeNull();
  });

  it("never picks a winner from scouted totals when an alliance is withheld", () => {
    const unplayed = official({ played: false, red: { teams: [1, 2], score: null, penaltyPoints: null }, blue: { teams: [3, 4], score: null, penaltyPoints: null } });
    // No official scores -> no accuracy -> a threshold withholds both.
    expect(run([unplayed], fullEntries(), 75)[0].winner).toBeNull();
  });
});

describe("buildMatchBreakdowns: practice data", () => {
  it("uses only the most recent session's entries for an alliance", () => {
    const old = [entry(1, 1, { sessionId: "S-OLD", source: "practice", mode: "trial", submittedAt: "2026-01-01T00:00:00.000Z" }), entry(2, 1, { sessionId: "S-OLD", source: "practice", mode: "trial", submittedAt: "2026-01-01T00:00:01.000Z" })];
    const recent = [entry(1, 25, { sessionId: "S-NEW", source: "practice", mode: "trial", submittedAt: "2026-02-01T00:00:00.000Z" }), entry(2, 25, { sessionId: "S-NEW", source: "practice", mode: "trial", submittedAt: "2026-02-01T00:00:01.000Z" })];
    const [m] = run([official()], [...old, ...recent], null, true);
    expect(m.red.scoutedTotal).toBe(50);
    expect(m.red.accuracy).toBeCloseTo(100);
  });

  it("does not mix robots across different sessions", () => {
    const a = entry(1, 25, { sessionId: "S-A", source: "practice", mode: "trial", submittedAt: "2026-02-01T00:00:00.000Z" });
    const b = entry(2, 25, { sessionId: "S-B", source: "practice", mode: "trial", submittedAt: "2026-02-02T00:00:00.000Z" });
    const [m] = run([official()], [a, b], null, true);
    expect(m.red.scoutedCount).toBe(1);
    expect(m.red.teams.find((t) => t.teamNumber === 2)?.scouted).toBe(true);
    expect(m.red.teams.find((t) => t.teamNumber === 1)?.scouted).toBe(false);
  });
});

describe("ordering and search", () => {
  it("sorts by match type (P, Q, F), then number, then event", () => {
    const rows = run(
      [
        official({ matchType: "Playoff", matchNumber: 1 }),
        official({ matchType: "Qualification", matchNumber: 10 }),
        official({ matchType: "Practice", matchNumber: 2 }),
        official({ matchType: "Qualification", matchNumber: 2, eventCode: "ZZZ" }),
        official({ matchType: "Qualification", matchNumber: 2, eventCode: "AAA" }),
      ],
      []
    );
    expect(rows.map((r) => `${r.match.eventCode}:${r.label}`)).toEqual(["EVT1:P2", "AAA:Q2", "ZZZ:Q2", "EVT1:Q10", "EVT1:F1"]);
  });

  it("matches a team-number search against both alliances", () => {
    const [m] = run([official()], []);
    expect(matchHasTeam(m, "")).toBe(true);
    expect(matchHasTeam(m, "3")).toBe(true);
    expect(matchHasTeam(m, " 4 ")).toBe(true);
    expect(matchHasTeam(m, "99")).toBe(false);
  });
});

describe("converters", () => {
  it("converts a FIRST API match", () => {
    const ftc: FtcMatch = {
      id: "x",
      matchNumber: 7,
      type: "Playoff",
      description: null,
      series: 1,
      played: true,
      redTeams: [1, 2],
      blueTeams: [3, 4],
      redScore: 90,
      blueScore: 80,
      redPenaltyPoints: 10,
      bluePenaltyPoints: null,
      startTime: null,
    };
    expect(ftcMatchToOfficial("EVT9", ftc)).toEqual({
      eventCode: "EVT9",
      matchType: "Playoff",
      matchNumber: 7,
      played: true,
      series: 1, // P16: the playoff series number rides along, so Scout Status can find the Finals
      startTime: null,
      red: { teams: [1, 2], score: 90, penaltyPoints: 10 },
      blue: { teams: [3, 4], score: 80, penaltyPoints: null },
    });
  });

  it("converts a library match (always played)", () => {
    const lib = {
      eventCode: "LIB1",
      matchType: "Qualification",
      matchNumber: 3,
      alliances: {
        red: { teams: [1, 2], score: 60, penaltyPoints: 5, difficulty: "easy" },
        blue: { teams: [3, 4], score: 70, penaltyPoints: 0, difficulty: "easy" },
      },
    } as unknown as LibraryMatch;
    expect(libraryMatchToOfficial(lib)).toMatchObject({ eventCode: "LIB1", played: true, red: { score: 60, penaltyPoints: 5 }, blue: { score: 70 } });
  });
});

describe("summarizeEntry", () => {
  it("sums counters by game element, lists toggles that were on, and the incidents", () => {
    const e = entry(1, 40, {
      fields: {
        autoLeave: true,
        autoPark: true,
        endgamePark: true,
        autoTipHive: 1,
        teleTipHive: 2,
        flowerPollenNectar: 4,
        diedDuringMatch: true,
        yellowCard: true,
      },
    });
    const s = summarizeEntry(e, BIOBUZZ_FORM_SCHEMA);
    expect(s.counts).toEqual(expect.arrayContaining([{ label: "Hive", count: 3 }, { label: "Flower", count: 4 }]));
    expect(s.counts.find((c) => c.label === "Garden")).toBeUndefined();
    // "Park" appears in both phases, so the phase is added; "Leave" is unique.
    expect(s.toggles.sort()).toEqual(["Leave", "Park (auto)", "Park (endgame)"].sort());
    expect(s.incidents.sort()).toEqual(["Died During Match", "Yellow Card"]);
  });

  it("is empty for a quiet robot", () => {
    expect(summarizeEntry(entry(1, 0), BIOBUZZ_FORM_SCHEMA)).toEqual({ counts: [], toggles: [], incidents: [] });
  });
});
