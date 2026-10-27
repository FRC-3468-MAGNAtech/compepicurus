import { describe, expect, it } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";
import { computePendingLiveRobots } from "./pending";

function liveSession(overrides: Partial<PracticeSession> & { id: string; uid: string }): PracticeSession {
  return {
    teamId: "team1",
    scoutName: overrides.uid,
    kind: "live",
    seasonId: "biobuzz",
    mode: null,
    difficulty: null,
    libraryMatchId: null,
    eventCode: "USWABON1",
    alliance: "red",
    robots: [100],
    allianceTeams: [100, 200],
    status: "completed",
    completedRobots: [100],
    entryIds: ["e1"],
    accuracy: null,
    scoutedTotal: null,
    penaltyPoints: null,
    officialScore: null,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
    matchType: "Qualification",
    matchNumber: 12,
    streamUrl: "https://youtu.be/abc12345678",
    streamStartSec: 120,
    streamEndSec: 300,
    ...overrides,
  };
}

describe("computePendingLiveRobots", () => {
  it("lists the sibling robot when nobody has covered it", () => {
    const sessions = [liveSession({ id: "s1", uid: "scout-a" })];
    const pending = computePendingLiveRobots(sessions, "scout-a");
    expect(pending).toHaveLength(1);
    expect(pending[0].teamNumber).toBe(200);
    expect(pending[0].sessionId).toBe("s1");
  });

  it("excludes it once another session covers the sibling robot", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a" }),
      liveSession({ id: "s2", uid: "scout-b", robots: [200], completedRobots: [200] }),
    ];
    expect(computePendingLiveRobots(sessions, "scout-a")).toHaveLength(0);
  });

  it("still counts as covered while someone else is actively scouting it (not just completed)", () => {
    const sessions = [
      liveSession({ id: "s1", uid: "scout-a" }),
      liveSession({ id: "s2", uid: "scout-b", robots: [200], status: "in-progress", completedRobots: [] }),
    ];
    expect(computePendingLiveRobots(sessions, "scout-a")).toHaveLength(0);
  });

  it("ignores sessions belonging to other scouts", () => {
    const sessions = [liveSession({ id: "s1", uid: "scout-a" })];
    expect(computePendingLiveRobots(sessions, "scout-b")).toHaveLength(0);
  });
});
