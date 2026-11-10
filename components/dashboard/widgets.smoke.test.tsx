import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { selectAnalyticsEntries } from "@/lib/analytics/entries";
import { DEFAULT_FILTERS } from "@/lib/analytics/filters";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import { buildAllTeamStats, rankTeams } from "@/lib/analytics/team-stats";
import { DashboardContext, type DashboardData } from "@/lib/dashboard/data";
import { buildOurMatches, nextOurMatch, ourRecord } from "@/lib/dashboard/schedule";
import { sourcesFor } from "@/lib/dashboard/roles";
import type { FtcEvent, FtcRanking, FtcTeam } from "@/lib/ftc/types";
import type { PracticeSession } from "@/lib/practice-sessions";
import { ROLES, type RoleId } from "@/lib/roles";
import { initialScoutEntryFields, type ScoutEntry, type ScoutEntryFields } from "@/lib/scout-entries";
import { BIOBUZZ_FORM_SCHEMA, calculateScore } from "@/lib/scout-form/schema";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import type { ScoutCategory } from "@/lib/scout-stats/types";
import type { TeamMember } from "@/lib/team-members";
import { dashboardRegistry } from "./registry";
import { HeaderStrip } from "./header-strip";

// A smoke harness for the dashboard (P13): every widget of every role is
// rendered against realistic, loading, and empty data. It can't judge layout,
// but it proves no widget throws on any of the data shapes it will meet, that
// the loading state really is a skeleton, and that key numbers appear.

const US = 3468;
const EVENT: FtcEvent = {
  code: "TEST1",
  season: 2026,
  name: "Test Invitational",
  dateStart: "2026-11-01",
  dateEnd: "2026-11-30",
  city: null,
  stateProv: null,
  country: null,
  venue: null,
  website: null,
  timezone: "America/Los_Angeles",
  status: "in-progress",
};

const side = (teams: number[], score: number | null, penaltyPoints: number | null = 0) => ({ teams, score, penaltyPoints });
const match = (matchNumber: number, red: ReturnType<typeof side>, blue: ReturnType<typeof side>, played: boolean, startTime: string | null = null): OfficialMatch => ({
  eventCode: EVENT.code,
  matchType: "Qualification",
  matchNumber,
  played,
  startTime,
  red,
  blue,
});

let n = 0;
function entry(teamNumber: number, matchNumber: number, fieldValues: Partial<ScoutEntryFields> = {}, over: Partial<ScoutEntry> = {}): ScoutEntry {
  n += 1;
  const fields = { ...initialScoutEntryFields, ...fieldValues };
  return {
    id: `e${n}`,
    teamId: "team",
    uid: "u1",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: "Ann Scout",
    eventCode: EVENT.code,
    matchType: "Qualification",
    matchNumber,
    teamNumber,
    fields,
    score: calculateScore(BIOBUZZ_FORM_SCHEMA, fields as unknown as Record<string, boolean | number>),
    comments: teamNumber === US ? "Great driving, one brownout late" : "",
    submittedAt: `2026-11-05T10:${String(n % 60).padStart(2, "0")}:00.000Z`,
    excluded: false,
    autoFlags: n % 4 === 0 ? [{ ruleId: "no-teleop", dismissed: false }] : [],
    manualFlags: [],
    accuracy: { status: "complete", value: 0.9, scoutedTotal: 1, penaltyPoints: 0, officialScore: 1 },
    sessionId: null,
    libraryMatchId: null,
    ...over,
  };
}

const members: TeamMember[] = [
  { uid: "u1", name: "Ann Scout", email: "a@x.com", primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false },
  { uid: "u2", name: "Bo Scout", email: "b@x.com", primaryRole: "match-scout", secondaryRoles: ["lead-scout"], isAdmin: true, isOwner: false },
];

const session = (id: string, over: Partial<PracticeSession>): PracticeSession =>
  ({
    id,
    teamId: "team",
    uid: "u1",
    scoutName: "Ann Scout",
    kind: "solo",
    seasonId: "biobuzz",
    mode: "trial",
    difficulty: "easy",
    libraryMatchId: null,
    eventCode: null,
    alliance: "red",
    robots: [1, 2],
    status: "completed",
    completedRobots: [1, 2],
    entryIds: [],
    accuracy: 82,
    scoutedTotal: 60,
    penaltyPoints: 0,
    officialScore: 70,
    platform: "pc",
    flags: [{ type: "x", title: "Fast", detail: "d", dismissed: false }],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-11-04T10:00:00.000Z",
    finishedAt: "2026-11-04T10:20:00.000Z",
    matchType: null,
    matchNumber: null,
    allianceTeams: null,
    streamUrl: null,
    streamStartSec: null,
    streamEndSec: null,
    ...over,
  }) as PracticeSession;

function makeData(role: RoleId, mode: "rich" | "loading" | "empty"): DashboardData {
  const rich = mode === "rich";
  const loading = mode === "loading";

  const teams: FtcTeam[] = rich ? [US, 111, 222, 333, 444, 555].map((t) => ({ teamNumber: t, nameShort: `Team ${t}`, nameFull: `Team ${t}`, city: null, stateProv: null, country: null, rookieYear: null })) : [];
  const rankings: FtcRanking[] = rich ? [111, 222, 333, US, 444, 555].map((t, i) => ({ teamNumber: t, rank: i + 1, wins: 5 - i, losses: i, ties: 0, matchesPlayed: 6, rankingPoints: 2 })) : [];
  const officialMatches: OfficialMatch[] = rich
    ? [
        match(1, side([US, 111], 85, 10), side([222, 333], 70), true),
        match(2, side([444, 555], 50), side([US, 222], 40), true),
        match(3, side([US, 444], null), side([111, 555], null), false, "2099-01-01T10:00:00"),
        match(4, side([333, 555], null), side([US, 111], null), false, "2099-01-01T10:10:00"),
        match(5, side([222, 333], 90), side([111, 444], 60), true),
      ]
    : [];

  const allEntries: ScoutEntry[] = rich
    ? [
        entry(US, 1, { autoLeave: true, autoPark: true, teleTipHive: 1 }),
        entry(US, 2, { autoLeave: true, diedDuringMatch: true }),
        entry(US, 3, { autoLeave: true, autoPark: true, endgamePark: true, teleTipHive: 2 }),
        entry(US, 4, { autoLeave: true, teleTipHive: 2, flowerPollenNectar: 3 }),
        entry(111, 1, { autoLeave: true, teleTipHive: 1 }),
        entry(111, 5, { teleTipHive: 2 }),
        entry(222, 1, { autoLeave: true }),
        entry(222, 5, { autoLeave: true, teleTipHive: 1 }),
        entry(333, 1, {}),
      ]
    : [];

  const eventEntries = allEntries.filter((e) => e.source === "event" && e.eventCode === EVENT.code);
  const usedEntries = selectAnalyticsEntries({ entries: allEntries, sessionsById: new Map(), filters: { ...DEFAULT_FILTERS, events: { kind: "custom", codes: [EVENT.code] } }, activeEventCodes: [] }).used;
  const teamNames = new Map(teams.map((t) => [t.teamNumber, t.nameShort]));
  const teamStats = buildAllTeamStats(usedEntries, BIOBUZZ_FORM_SCHEMA, teamNames);
  const ranked = rankTeams(teamStats, "avgTotal");

  const ourMatches = buildOurMatches(officialMatches, US, EVENT.timezone);
  const ourRanking = rankings.find((r) => r.teamNumber === US) ?? null;

  const sessions: PracticeSession[] = rich
    ? [
        session("PS-AAAAAA", {}),
        session("PS-BBBBBB", { mode: "competitive", accuracy: 91, flags: [], finishedAt: "2026-11-05T09:00:00.000Z" }),
        session("PS-CCCCCC", { status: "paused", finishedAt: null, completedRobots: [1] }),
        session("LV-DDDDDD", { kind: "live", mode: null, eventCode: EVENT.code, matchType: "Qualification", matchNumber: 7, alliance: "red", robots: [111], allianceTeams: [111, 222], completedRobots: [111] }),
      ]
    : [];

  const needsMembers = sourcesFor(role, true).has("members");
  const scoutStats =
    needsMembers && !loading
      ? (Object.fromEntries(
          (["trial", "competitive", "real-event"] as ScoutCategory[]).map((category) => [
            category,
            computeScoutStats({
              category,
              members: rich ? members : [],
              sessions: sessions.filter((s) => s.kind === "solo"),
              entries: allEntries,
              libraryMatchesById: new Map(),
              attendance: [],
              roleFilter: [],
              eventFilter: [],
              rankingBasis: "preserve",
              realEventScope: { eventCode: null, variant: "plain" },
            }),
          ])
        ) as unknown as DashboardData["scoutStats"])
      : null;

  return {
    uid: "u1",
    userName: "Ann Scout",
    teamId: "team",
    isAdmin: false,
    role,
    ourNumber: US,
    needs: sourcesFor(role, false),
    events: [EVENT],
    eventsLoaded: true,
    event: EVENT,
    eventStatus: "in-progress",
    setEventCode: () => {},
    timeZone: EVENT.timezone,
    first: { loading, error: false },
    officialMatches,
    rankings,
    teams,
    teamNames,
    ourMatches,
    nextMatch: nextOurMatch(ourMatches),
    ourRanking,
    record: ourRecord(ourRanking, ourMatches),
    fieldSize: rich ? 6 : 0,
    entriesLoaded: !loading,
    allEntries,
    eventEntries,
    usedEntries,
    schema: BIOBUZZ_FORM_SCHEMA,
    teamStats,
    ranked,
    ourStats: teamStats.find((t) => t.teamNumber === US) ?? null,
    ourScoutedRank: ranked.find((r) => r.stats.teamNumber === US)?.rank ?? null,
    members: rich ? members : [],
    membersLoaded: !loading,
    sessions,
    sessionsLoaded: !loading,
    libraryById: new Map(),
    attendance: [],
    attendingUids: rich ? ["u1", "u2"] : [],
    attendanceLoaded: !loading,
    assignments: rich
      ? ({
          id: "team_TEST1",
          teamId: "team",
          eventCode: EVENT.code,
          previous: null,
          current: { slots: [{ matchType: "Qualification", matchNumber: 6, slot: "red1", teamNumber: 222, scoutUid: "u1" }] },
        } as unknown as DashboardData["assignments"])
      : null,
    assignmentsLoaded: !loading,
    pickList: rich ? { teamId: "team", eventCode: EVENT.code, picked: [111, 222], updatedBy: "u2", updatedByName: "Bo", updatedAtMs: 1 } : null,
    pickListLoaded: !loading,
    formEntries: [],
    formEntriesLoaded: !loading,
    teamAssignments: [],
    teamAssignmentsLoaded: !loading,
    scoutStats,
  };
}

/** Server HTML with React's text-node separators and entity escapes normalized, so assertions read like the screen. */
const render = (data: DashboardData, node: React.ReactNode) =>
  renderToString(<DashboardContext.Provider value={data}>{node}</DashboardContext.Provider>)
    .replace(/<!-- -->/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'");

describe("dashboard widgets render against every data shape", () => {
  for (const { id: role } of ROLES) {
    for (const mode of ["rich", "loading", "empty"] as const) {
      it(`${role}: every widget renders with ${mode} data`, () => {
        const data = makeData(role, mode);
        for (const w of dashboardRegistry[role]) {
          const html = render(data, w.render());
          expect(html.length, `${w.id} rendered nothing`).toBeGreaterThan(0);
          // The title always shows, so a widget is never a blank hole — unless it's the dashed Coming-soon card, which has its own heading.
          expect(html, `${w.id} has no title`).toContain(w.title);
        }
      });
    }

    it(`${role}: the loading state is a skeleton (aria-busy) for every data-backed widget`, () => {
      const data = makeData(role, "loading");
      for (const w of dashboardRegistry[role]) {
        if (w.id.endsWith("-soon") || w.id === "team-lookup") continue;
        const html = render(data, w.render());
        // A few widgets are interactive shells that stay usable while loading (e.g. the lookup box) — everything else must skeleton.
        expect(html.includes('aria-busy="true"'), `${role}/${w.id} should show a skeleton while loading`).toBe(true);
      }
    });
  }
});

describe("what the widgets show", () => {
  it("Match Scout: the next assignment names the match and robot and offers Scout now", () => {
    const html = render(makeData("match-scout", "rich"), dashboardRegistry["match-scout"][0].render());
    expect(html).toContain("Q6");
    expect(html).toContain("Team 222");
    expect(html).toContain("Scout now");
    expect(html).toContain("load=next");
  });

  it("Match Scout: shows a paused session to resume and a pending live robot", () => {
    const html = render(makeData("match-scout", "rich"), dashboardRegistry["match-scout"][2].render());
    expect(html).toContain("Paused session");
    expect(html).toContain("PS-CCCCCC");
    expect(html).toContain("pending live");
  });

  it("Drive Team: previews the partner and both opponents, with their scouted numbers", () => {
    const html = render(makeData("drive-team", "rich"), dashboardRegistry["drive-team"][1].render());
    for (const team of ["444", "111", "555"]) expect(html).toContain(team);
    expect(html).toContain("Partner");
    expect(html).toContain("Opponent");
  });

  it("Media: results are in the shareable format and the copy buttons exist", () => {
    const html = render(makeData("media", "rich"), dashboardRegistry.media[2].render());
    expect(html).toContain("Q1: Red 85 - Blue 70 (W)");
    expect(html).toContain("Q2: Red 50 - Blue 40 (L)");
    expect(html).toContain("Copy");
  });

  it("Pit Team: lists the robot-failure incidents scouts saw on us", () => {
    const html = render(makeData("pit-team", "rich"), dashboardRegistry["pit-team"][2].render());
    expect(html).toContain("Died During Match");
    expect(html).toContain("Great driving");
  });

  it("Lead Scout: coverage and accuracy summary render real numbers", () => {
    const data = makeData("lead-scout", "rich");
    expect(render(data, dashboardRegistry["lead-scout"][0].render())).toContain("Scouting coverage");
    const accuracy = render(data, dashboardRegistry["lead-scout"][1].render());
    expect(accuracy).toContain("Mentor Intervention");
    expect(accuracy).toContain("Excellent");
  });

  it("Lead Strategist: the pick list snapshot lists the picked teams in order", () => {
    const html = render(makeData("lead-strategist", "rich"), dashboardRegistry["lead-strategist"].find((w) => w.id === "pick-list")!.render());
    expect(html.indexOf("111")).toBeGreaterThan(-1);
    expect(html.indexOf("111")).toBeLessThan(html.indexOf("222"));
    expect(html).toContain("Estimate, not a prediction");
  });

  it("Judge Awards and Media get exactly one visible 'Coming soon' card each (the Pit Scout has real widgets since P29)", () => {
    for (const role of ["judge-awards", "media"] as const) {
      const data = makeData(role, "rich");
      const count = dashboardRegistry[role].map((w) => render(data, w.render())).filter((h) => h.includes("Coming soon")).length;
      expect(count, role).toBe(1);
    }
  });

  it("an empty dashboard shows friendly empty states, never a raw error", () => {
    const data = makeData("pit-team", "empty");
    for (const w of dashboardRegistry["pit-team"]) {
      const html = render(data, w.render());
      expect(html).not.toContain("NaN");
      expect(html).not.toContain("undefined");
    }
  });

  it("an API failure with no data shows the error state on schedule widgets", () => {
    const data = { ...makeData("pit-team", "empty"), first: { loading: false, error: true } };
    const html = render(data, dashboardRegistry["pit-team"][0].render());
    expect(html).toContain("couldn't be loaded");
  });
});

describe("header strip", () => {
  it("shows the event, our rank and record, and the next match with its alliance and partner", () => {
    const html = render(makeData("pit-team", "rich"), <HeaderStrip />);
    expect(html).toContain("Test Invitational");
    expect(html).toContain("#4");
    expect(html).toContain("Q3");
    expect(html).toContain("red alliance");
    expect(html).toContain("444");
    expect(html).toContain("Scheduled");
  });

  it("is a skeleton while the official data loads", () => {
    expect(render(makeData("pit-team", "loading"), <HeaderStrip />)).toContain("shimmer");
  });
});
