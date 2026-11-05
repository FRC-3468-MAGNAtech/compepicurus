import { describe, expect, it } from "vitest";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import type { OfficialAlliance, OfficialMatch } from "@/lib/analytics/match-breakdown";
import { buildTeamStats } from "@/lib/analytics/team-stats";
import type { AssignmentsDoc } from "@/lib/assignments";
import type { PracticeSession } from "@/lib/practice-sessions";
import { initialScoutEntryFields, type ScoutEntry, type ScoutEntryFields } from "@/lib/scout-entries";
import { BIOBUZZ_FORM_SCHEMA, calculateScore } from "@/lib/scout-form/schema";
import {
  HIDDEN_GEM_MIN_GAP,
  assignmentStatus,
  averageAccuracy,
  countFlaggedSessions,
  computeCoverage,
  computeTeamCoverage,
  countByStatus,
  eventHighlights,
  findHiddenGems,
  nextAssignment,
  flaggedEntries,
  phaseAverages,
  practiceActivity,
  strengthBullets,
} from "./insights";

let n = 0;
function entry(teamNumber: number, over: Partial<ScoutEntry> & { fieldValues?: Partial<ScoutEntryFields> } = {}): ScoutEntry {
  n += 1;
  const { fieldValues, ...rest } = over;
  const fields = { ...initialScoutEntryFields, ...fieldValues };
  return {
    id: `e${n}`,
    teamId: "t",
    uid: "u",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "S",
    eventCode: "EVT",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber,
    fields,
    score: calculateScore(BIOBUZZ_FORM_SCHEMA, fields as unknown as Record<string, boolean | number>),
    comments: "",
    submittedAt: `2026-01-01T00:00:${String(n % 60).padStart(2, "0")}.000Z`,
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...rest,
  };
}
const analytic = (e: ScoutEntry, allianceAccuracy: number | null = null): AnalyticsEntry => ({ ...e, allianceAccuracy, isExcluded: e.excluded });

const side = (teams: number[], score: number | null = null): OfficialAlliance => ({ teams, score, penaltyPoints: 0 });
const official = (matchNumber: number, red: OfficialAlliance, blue: OfficialAlliance, over: Partial<OfficialMatch> = {}): OfficialMatch => ({
  eventCode: "EVT",
  matchType: "Qualification",
  matchNumber,
  played: true,
  red,
  blue,
  ...over,
});

describe("computeCoverage", () => {
  const matches = [
    official(1, side([1, 2], 50), side([3, 4], 40)),
    official(2, side([1, 3], 50), side([2, 4], 40)),
    official(3, side([1, 2]), side([3, 4]), { played: false }), // not played: ignored
    official(4, side([1, 2], 10), side([3, 4], 10), { matchType: "Practice" }), // practice: ignored
  ];

  it("counts played matches where every robot has a real-event entry", () => {
    const entries = [entry(1, { matchNumber: 1 }), entry(2, { matchNumber: 1 }), entry(3, { matchNumber: 1 }), entry(4, { matchNumber: 1 }), entry(1, { matchNumber: 2 }), entry(2, { matchNumber: 2 })];
    const c = computeCoverage(matches, entries);
    expect(c.playedMatches).toBe(2);
    expect(c.fullyScouted).toBe(1);
    expect(c.percent).toBe(50);
    expect(c.missing).toEqual([{ key: "EVT|Qualification|2", label: "Q2", missingTeams: [3, 4] }]);
  });

  it("does not count excluded entries, practice entries, or another event's entries", () => {
    const entries = [
      entry(1, { matchNumber: 1 }),
      entry(2, { matchNumber: 1, excluded: true }),
      entry(3, { matchNumber: 1, source: "practice", mode: "trial" }),
      entry(4, { matchNumber: 1, eventCode: "OTHER" }),
    ];
    const c = computeCoverage([matches[0]], entries);
    expect(c.fullyScouted).toBe(0);
    expect(c.missing[0].missingTeams).toEqual([2, 3, 4]);
  });

  it("has no percent before any match has been played", () => {
    expect(computeCoverage([], [])).toEqual({ playedMatches: 0, fullyScouted: 0, percent: null, missing: [] });
    expect(computeCoverage([matches[2]], []).percent).toBeNull();
  });

  it("covers finals matches too", () => {
    const f = official(1, side([1, 2], 5), side([3, 4], 4), { matchType: "Playoff" });
    expect(computeCoverage([f], [entry(1, { matchType: "Playoff" })]).missing[0].label).toBe("F1");
  });
});

describe("computeTeamCoverage", () => {
  it("lists teams with no entries and the coverage percent", () => {
    const c = computeTeamCoverage([10, 20, 30, 40, 20], [entry(10), entry(10), entry(30), entry(40, { excluded: true })]);
    expect(c).toEqual({ total: 4, scouted: 2, percent: 50, zero: [20, 40] });
  });

  it("ignores practice entries and handles an empty event", () => {
    expect(computeTeamCoverage([10], [entry(10, { source: "practice", mode: "trial" })]).zero).toEqual([10]);
    expect(computeTeamCoverage([], [])).toEqual({ total: 0, scouted: 0, percent: null, zero: [] });
  });
});

describe("flaggedEntries", () => {
  it("returns entries with an undismissed auto flag, newest first, skipping excluded ones", () => {
    const flagged = entry(1, { autoFlags: [{ ruleId: "x", dismissed: false }], submittedAt: "2026-01-02T00:00:00.000Z" });
    const older = entry(2, { autoFlags: [{ ruleId: "x", dismissed: false }, { ruleId: "y", dismissed: true }], submittedAt: "2026-01-01T00:00:00.000Z" });
    const dismissed = entry(3, { autoFlags: [{ ruleId: "x", dismissed: true }] });
    const excluded = entry(4, { autoFlags: [{ ruleId: "x", dismissed: false }], excluded: true });
    expect(flaggedEntries([older, dismissed, excluded, flagged]).map((e) => e.teamNumber)).toEqual([1, 2]);
  });
});

describe("countByStatus", () => {
  it("counts per band in worst-to-best order and separates the unrated", () => {
    const r = countByStatus([
      { status: { id: "mentor-intervention" } },
      { status: { id: "mentor-intervention" } },
      { status: { id: "good" } },
      { status: { id: "excellent" } },
      { status: null },
    ]);
    expect(r.bands.map((b) => [b.id, b.count])).toEqual([
      ["mentor-intervention", 2],
      ["student-intervention", 0],
      ["good", 1],
      ["excellent", 1],
    ]);
    expect(r.bands[0].label).toBe("Mentor Intervention");
    expect(r.unrated).toBe(1);
  });
});

describe("assignmentStatus", () => {
  const doc = (slots: { scoutUid: string | null }[]): AssignmentsDoc =>
    ({ id: "x", teamId: "t", eventCode: "EVT", previous: null, current: { slots } as AssignmentsDoc["current"] }) as AssignmentsDoc;
  const members = [{ uid: "a", name: "Ann" }, { uid: "b", name: "Bo" }, { uid: "c", name: "Cy" }];

  it("is unpublished without a current schedule", () => {
    expect(assignmentStatus(null, ["a"], members)).toEqual({ published: false, slotCount: 0, unassigned: [] });
    expect(assignmentStatus({ ...doc([]), current: null }, ["a"], members).published).toBe(false);
  });

  it("names attending members who have no slot", () => {
    const s = assignmentStatus(doc([{ scoutUid: "a" }, { scoutUid: "a" }, { scoutUid: null }]), ["a", "b", "c"], members);
    expect(s).toEqual({ published: true, slotCount: 3, unassigned: ["Bo", "Cy"] });
  });
});

describe("practiceActivity", () => {
  const NOW = Date.parse("2026-02-10T12:00:00Z");
  const s = (uid: string, finishedAt: string | null, over: Partial<PracticeSession> = {}) =>
    ({ uid, status: "completed", excluded: false, startedAt: "2026-02-01T00:00:00Z", finishedAt, ...over }) as PracticeSession;

  it("counts completed sessions finished in the last 7 days and the distinct scouts", () => {
    const r = practiceActivity([s("a", "2026-02-09T00:00:00Z"), s("a", "2026-02-08T00:00:00Z"), s("b", "2026-02-05T00:00:00Z"), s("c", "2026-02-01T00:00:00Z")], NOW);
    expect(r).toEqual({ sessions: 3, scouts: 2 });
  });

  it("skips unfinished and excluded sessions", () => {
    expect(practiceActivity([s("a", null, { status: "paused", startedAt: "2026-02-09T00:00:00Z" }), s("b", "2026-02-09T00:00:00Z", { excluded: true })], NOW)).toEqual({ sessions: 0, scouts: 0 });
  });
});

describe("nextAssignment", () => {
  const slot = (matchType: "Qualification" | "Playoff", matchNumber: number, teamNumber: number, scoutUid: string | null) => ({ matchType, matchNumber, slot: "red1" as const, teamNumber, scoutUid });
  const slots = [slot("Qualification", 9, 90, "me"), slot("Qualification", 3, 30, "me"), slot("Qualification", 5, 50, "other"), slot("Playoff", 1, 10, "me"), slot("Qualification", 7, 70, null)];

  it("is my earliest assigned slot I haven't scouted yet", () => {
    expect(nextAssignment(slots, "me", "EVT", [])).toMatchObject({ matchNumber: 3, teamNumber: 30 });
  });

  it("skips slots I've already submitted an entry for, in order", () => {
    const done = [entry(30, { uid: "me", matchNumber: 3 })];
    expect(nextAssignment(slots, "me", "EVT", done)).toMatchObject({ matchNumber: 9 });
    const more = [...done, entry(90, { uid: "me", matchNumber: 9 })];
    expect(nextAssignment(slots, "me", "EVT", more)).toMatchObject({ matchType: "Playoff", matchNumber: 1 });
  });

  it("does not count someone else's entry, a practice entry, another event, or another robot", () => {
    const entries = [
      entry(30, { uid: "other", matchNumber: 3 }),
      entry(30, { uid: "me", matchNumber: 3, source: "practice", mode: "trial" }),
      entry(30, { uid: "me", matchNumber: 3, eventCode: "OTHER" }),
      entry(31, { uid: "me", matchNumber: 3 }),
    ];
    expect(nextAssignment(slots, "me", "EVT", entries)).toMatchObject({ matchNumber: 3, teamNumber: 30 });
  });

  it("is null when everything is scouted, or nothing is assigned to me", () => {
    const all = [entry(30, { uid: "me", matchNumber: 3 }), entry(90, { uid: "me", matchNumber: 9 }), entry(10, { uid: "me", matchType: "Playoff", matchNumber: 1 })];
    expect(nextAssignment(slots, "me", "EVT", all)).toBeNull();
    expect(nextAssignment(slots, "nobody", "EVT", [])).toBeNull();
    expect(nextAssignment([], "me", "EVT", [])).toBeNull();
  });
});

describe("countFlaggedSessions", () => {
  const f = (dismissed: boolean) => ({ type: "x", title: "x", detail: "x", dismissed });
  it("counts sessions with an undismissed flag, skipping excluded ones", () => {
    expect(
      countFlaggedSessions([
        { flags: [f(false)], excluded: false },
        { flags: [f(true), f(false)], excluded: false },
        { flags: [f(true)], excluded: false },
        { flags: [], excluded: false },
        { flags: [f(false)], excluded: true },
      ])
    ).toBe(2);
  });
});

describe("averageAccuracy / phaseAverages", () => {
  it("averages the accuracies that exist", () => {
    expect(averageAccuracy([{ allianceAccuracy: 80 }, { allianceAccuracy: 90 }, { allianceAccuracy: null }])).toBe(85);
    expect(averageAccuracy([{ allianceAccuracy: null }])).toBeNull();
    expect(averageAccuracy([])).toBeNull();
  });

  it("averages each phase over the entries", () => {
    expect(phaseAverages([{ score: { auto: 10, teleop: 20, endgame: 0, total: 30 } }, { score: { auto: 20, teleop: 40, endgame: 10, total: 70 } }])).toEqual({ auto: 15, teleop: 30, endgame: 5 });
    expect(phaseAverages([])).toBeNull();
  });
});

describe("findHiddenGems", () => {
  const team = (teamNumber: number, officialRank: number | null, scoutedRank: number | null, entryCount = 4) => ({ teamNumber, teamName: null, officialRank, scoutedRank, entryCount });

  it("finds teams scouted far better than their official rank, biggest gap first", () => {
    const gems = findHiddenGems({ teams: [team(1, 20, 3), team(2, 12, 4), team(3, 10, 8), team(4, 30, 2)], fieldSize: 30 });
    // needed gap = max(5, ceil(30 * 0.2)) = 6
    expect(gems.map((g) => [g.teamNumber, g.gap])).toEqual([[4, 28], [1, 17], [2, 8]]);
  });

  it("needs both ranks and a real sample", () => {
    const gems = findHiddenGems({ teams: [team(1, null, 1), team(2, 30, null), team(3, 30, 1, 1)], fieldSize: 30 });
    expect(gems).toEqual([]);
  });

  it("scales the required gap with the field but never drops below the minimum", () => {
    expect(findHiddenGems({ teams: [team(1, 10, 5)], fieldSize: 10 }).length).toBe(1); // gap 5 >= max(5, 2)
    expect(findHiddenGems({ teams: [team(1, 10, 6)], fieldSize: 10 }).length).toBe(0); // gap 4 < 5
    expect(findHiddenGems({ teams: [team(1, 40, 20)], fieldSize: 100 }).length).toBe(1); // gap 20 >= ceil(100 * 0.2)
    expect(findHiddenGems({ teams: [team(1, 40, 21)], fieldSize: 100 }).length).toBe(0); // gap 19 < 20
    expect(HIDDEN_GEM_MIN_GAP).toBe(5);
  });

  it("limits the list", () => {
    const teams = Array.from({ length: 10 }, (_, i) => team(i + 1, 40, 1 + i));
    expect(findHiddenGems({ teams, fieldSize: 40, limit: 3 })).toHaveLength(3);
  });
});

describe("strengthBullets", () => {
  const stat = (rows: Partial<ScoutEntryFields>[]) =>
    buildTeamStats(
      rows.map((fieldValues, i) => analytic(entry(3468, { fieldValues, submittedAt: `2026-01-01T00:00:0${i}.000Z` }))),
      BIOBUZZ_FORM_SCHEMA
    );
  // 5 clean entries, always leaving and parking, and only the last four steadily climbing.
  const strong = stat([
    { autoLeave: true, autoPark: true, endgamePark: true, teleTipHive: 1 },
    { autoLeave: true, autoPark: true, endgamePark: true, teleTipHive: 1 },
    { autoLeave: true, autoPark: true, endgamePark: true, teleTipHive: 1 },
    { autoLeave: true, autoPark: true, endgamePark: true, teleTipHive: 2 },
    { autoLeave: true, autoPark: true, endgamePark: true, teleTipHive: 2 },
  ]);

  it("writes a bullet for each thing that's true", () => {
    const b = strengthBullets({ stats: strong, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: 2, fieldSize: 30, officialRank: 2, record: { wins: 4, losses: 1, ties: 0 } });
    expect(b).toContain("Ranked #2 in the official standings");
    expect(b).toContain("Winning record (4-1-0)");
    expect(b).toContain("Top 3 scouted average at this event");
    expect(b).toContain("Leave rate 100%");
    expect(b).toContain("Park (auto) rate 100%");
    expect(b).toContain("Park (endgame) rate 100%");
    expect(b.some((x) => x.startsWith("Reliable"))).toBe(true);
    expect(b.some((x) => x.startsWith("Scoring trending up"))).toBe(true);
  });

  it("hides every bullet that isn't true", () => {
    const b = strengthBullets({ stats: strong, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: 20, fieldSize: 30, officialRank: 15, record: { wins: 1, losses: 4, ties: 0 } });
    expect(b.some((x) => x.startsWith("Ranked"))).toBe(false);
    expect(b.some((x) => x.startsWith("Winning"))).toBe(false);
    expect(b.some((x) => x.startsWith("Top"))).toBe(false);
  });

  it("uses 'Top 25%' for a good-but-not-top-3 rank on a big enough field", () => {
    const b = strengthBullets({ stats: strong, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: 6, fieldSize: 30, officialRank: null, record: null });
    expect(b).toContain("Top 25% scouted average at this event");
    expect(strengthBullets({ stats: strong, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: 2, fieldSize: 5, officialRank: null, record: null })).toContain("Top 3 scouted average at this event");
  });

  it("drops reliability when robot failures were scouted", () => {
    const flaky = stat([{ diedDuringMatch: true }, { diedDuringMatch: true }, {}, {}]);
    expect(strengthBullets({ stats: flaky, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: null, fieldSize: 30, officialRank: null, record: null }).some((x) => x.startsWith("Reliable"))).toBe(false);
  });

  it("makes no stat-based claims from too small a sample, but still reports official results", () => {
    const tiny = stat([{ autoLeave: true }, { autoLeave: true }]);
    const b = strengthBullets({ stats: tiny, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: 1, fieldSize: 30, officialRank: 1, record: { wins: 2, losses: 0, ties: 0 } });
    expect(b).toEqual(["Ranked #1 in the official standings", "Winning record (2-0-0)"]);
  });

  it("is empty with nothing to say", () => {
    expect(strengthBullets({ stats: null, schema: BIOBUZZ_FORM_SCHEMA, scoutedRank: null, fieldSize: 0, officialRank: null, record: null })).toEqual([]);
  });
});

describe("eventHighlights", () => {
  const matches = [
    official(1, side([1, 2], 80), side([3, 4], 60)),
    official(2, side([3468, 5], 95), side([6, 7], 120)),
    official(3, side([3468, 5], 101), side([6, 7], 90)),
    official(4, side([8, 9], 300), side([10, 11], 1), { played: false }), // not played: ignored
    official(5, side([8, 9], 400), side([10, 11], 1), { matchType: "Practice" }), // practice: ignored
  ];

  it("finds the event's highest alliance score and our best match", () => {
    const h = eventHighlights(matches, 3468);
    expect(h.highest).toEqual({ score: 120, label: "Q2", color: "blue", teams: [6, 7] });
    expect(h.ourBest).toEqual({ score: 101, label: "Q3", color: "red" });
  });

  it("has no 'our best' for a team that hasn't played, and nothing for an empty event", () => {
    expect(eventHighlights(matches, 999).ourBest).toBeNull();
    expect(eventHighlights([], 3468)).toEqual({ highest: null, ourBest: null });
    expect(eventHighlights(matches, null).ourBest).toBeNull();
  });
});
