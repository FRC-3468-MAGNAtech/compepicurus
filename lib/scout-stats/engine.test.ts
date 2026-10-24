import { describe, expect, it } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { computeScoutStats, type ScoutStatsInput } from "./engine";

function member(overrides: Partial<TeamMember> & { uid: string }): TeamMember {
  return {
    name: overrides.uid,
    email: `${overrides.uid}@example.com`,
    primaryRole: "match-scout",
    secondaryRoles: [],
    isAdmin: false,
    isOwner: false,
    ...overrides,
  };
}

function session(overrides: Partial<PracticeSession> & { id: string; uid: string }): PracticeSession {
  return {
    teamId: "team1",
    scoutName: overrides.uid,
    kind: "solo",
    seasonId: "biobuzz",
    mode: "trial",
    difficulty: "medium",
    libraryMatchId: null,
    eventCode: null,
    alliance: "red",
    robots: [1, 2],
    status: "completed",
    completedRobots: [1, 2],
    entryIds: ["e1", "e2"],
    accuracy: 90,
    scoutedTotal: 90,
    penaltyPoints: 0,
    officialScore: 100,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    ...overrides,
  };
}

function entry(overrides: Partial<ScoutEntry> & { id: string; uid: string }): ScoutEntry {
  return {
    teamId: "team1",
    source: "event",
    mode: null,
    formId: "biobuzz",
    formVersion: 1,
    scoutName: overrides.uid,
    eventCode: "USWABON1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 1,
    fields: {} as ScoutEntry["fields"],
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
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

function baseInput(overrides: Partial<ScoutStatsInput> = {}): ScoutStatsInput {
  return {
    category: "trial",
    members: [],
    sessions: [],
    entries: [],
    libraryMatchesById: new Map(),
    attendance: [],
    roleFilter: [],
    eventFilter: [],
    rankingBasis: "preserve",
    realEventScope: { eventCode: null, variant: "plain" },
    ...overrides,
  };
}

describe("computeScoutStats — practice categories", () => {
  it("averages a scout's completed sessions in that mode, ignoring excluded ones", () => {
    const result = computeScoutStats(
      baseInput({
        category: "trial",
        members: [member({ uid: "a" })],
        sessions: [
          session({ id: "s1", uid: "a", mode: "trial", accuracy: 80 }),
          session({ id: "s2", uid: "a", mode: "trial", accuracy: 100 }),
          session({ id: "s3", uid: "a", mode: "trial", accuracy: 0, excluded: true }),
          session({ id: "s4", uid: "a", mode: "competitive", accuracy: 50 }), // different mode, ignored
        ],
      })
    );
    const row = result.rows[0];
    expect(row.accuracy).toBe(90); // mean(80,100), excluding the excluded 0 and the other mode
    expect(row.sessionsOrForms).toBe(3); // s1, s2, s3 — excluded still counts as "completed" activity
    expect(row.totalEntries).toBe(6); // 3 sessions * 2 entryIds each
  });

  it("shows '?' (null accuracy, null rank) for a scout with no sessions in this category", () => {
    const result = computeScoutStats(
      baseInput({
        members: [member({ uid: "a" }), member({ uid: "b" })],
        sessions: [session({ id: "s1", uid: "a", mode: "trial", accuracy: 90 })],
      })
    );
    const rowB = result.rows.find((r) => r.uid === "b")!;
    expect(rowB.accuracy).toBeNull();
    expect(rowB.rank).toBeNull();
    expect(rowB.status).toBeNull();
  });

  it("ranks descending with ties sharing a rank and the next rank skipping", () => {
    const result = computeScoutStats(
      baseInput({
        members: [member({ uid: "a" }), member({ uid: "b" }), member({ uid: "c" })],
        sessions: [
          session({ id: "s1", uid: "a", mode: "trial", accuracy: 90 }),
          session({ id: "s2", uid: "b", mode: "trial", accuracy: 90 }),
          session({ id: "s3", uid: "c", mode: "trial", accuracy: 70 }),
        ],
      })
    );
    const byUid = Object.fromEntries(result.rows.map((r) => [r.uid, r.rank]));
    expect(byUid.a).toBe(1);
    expect(byUid.b).toBe(1);
    expect(byUid.c).toBe(3);
  });

  it("role filter hides non-matching scouts but, under 'preserve', keeps their team-wide rank", () => {
    const result = computeScoutStats(
      baseInput({
        members: [member({ uid: "a", primaryRole: "lead-scout" }), member({ uid: "b", primaryRole: "match-scout" })],
        sessions: [
          session({ id: "s1", uid: "a", mode: "trial", accuracy: 70 }),
          session({ id: "s2", uid: "b", mode: "trial", accuracy: 90 }),
        ],
        roleFilter: ["lead-scout"],
        rankingBasis: "preserve",
      })
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].uid).toBe("a");
    expect(result.rows[0].rank).toBe(2); // b (90) outranks a (70) team-wide, even though b isn't shown
  });

  it("re-ranks within the role filter when ranking basis is 'role'", () => {
    const result = computeScoutStats(
      baseInput({
        members: [member({ uid: "a", primaryRole: "lead-scout" }), member({ uid: "b", primaryRole: "match-scout" })],
        sessions: [
          session({ id: "s1", uid: "a", mode: "trial", accuracy: 70 }),
          session({ id: "s2", uid: "b", mode: "trial", accuracy: 90 }),
        ],
        roleFilter: ["lead-scout"],
        rankingBasis: "role",
      })
    );
    expect(result.rows[0].rank).toBe(1); // only scout in the role-filtered pool
  });

  it("scopes summary stats to the currently-visible (filtered) scouts", () => {
    const result = computeScoutStats(
      baseInput({
        members: [member({ uid: "a", primaryRole: "lead-scout" }), member({ uid: "b", primaryRole: "match-scout" })],
        sessions: [
          session({ id: "s1", uid: "a", mode: "trial", accuracy: 70 }),
          session({ id: "s2", uid: "b", mode: "trial", accuracy: 90 }),
        ],
        roleFilter: ["lead-scout"],
      })
    );
    expect(result.summary.totalMembers).toBe(1);
    expect(result.summary.membersWithData).toBe(1);
    expect(result.summary.averageAccuracy).toBe(70);
  });
});

describe("computeScoutStats — real event", () => {
  it("weights an observation by the alliance partner's own estimate, resolved from shared accuracy.value (no FIRST API lookup needed)", () => {
    const result = computeScoutStats(
      baseInput({
        category: "real-event",
        members: [member({ uid: "a" }), member({ uid: "b" })],
        entries: [
          entry({ id: "e1", uid: "a", teamNumber: 1, matchNumber: 1, accuracy: { status: "complete", value: 1.0, scoutedTotal: 100, penaltyPoints: 0, officialScore: 100 } }),
          entry({ id: "e2", uid: "b", teamNumber: 2, matchNumber: 1, accuracy: { status: "complete", value: 1.0, scoutedTotal: 100, penaltyPoints: 0, officialScore: 100 } }),
        ],
        realEventScope: { eventCode: null, variant: "plain" },
      })
    );
    // Both scouts share one match with accuracy 1.0 and are each other's partner.
    const a = result.rows.find((r) => r.uid === "a")!;
    expect(a.accuracy).not.toBeNull();
    expect(a.accuracy!).toBeGreaterThan(0);
    expect(a.sessionsOrForms).toBe(1); // "forms completed"
    expect(a.totalEntries).toBeNull(); // not shown for Real Event
  });

  it("shows '?' for a scout with no real-event entries", () => {
    const result = computeScoutStats(
      baseInput({
        category: "real-event",
        members: [member({ uid: "a" })],
        entries: [],
      })
    );
    expect(result.rows[0].accuracy).toBeNull();
  });

  it("ignores excluded entries and non-'complete' accuracy when building observations", () => {
    const result = computeScoutStats(
      baseInput({
        category: "real-event",
        members: [member({ uid: "a" })],
        entries: [
          entry({ id: "e1", uid: "a", excluded: true, accuracy: { status: "complete", value: 1.0, scoutedTotal: 100, penaltyPoints: 0, officialScore: 100 } }),
          entry({ id: "e2", uid: "a", accuracy: { status: "needs-robots", value: null, scoutedTotal: null, penaltyPoints: null, officialScore: null } }),
        ],
      })
    );
    expect(result.rows[0].accuracy).toBeNull();
    expect(result.rows[0].sessionsOrForms).toBe(2); // "forms completed" still counts raw real-entry activity
  });
});
