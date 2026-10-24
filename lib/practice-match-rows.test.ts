import { describe, expect, it } from "vitest";
import { buildMatchRows, pickRandomMatchRow, sortMatchRows, type MatchRow } from "@/lib/practice-match-rows";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";

function makeMatch(overrides: Partial<LibraryMatch> & Pick<LibraryMatch, "id" | "matchNumber">): LibraryMatch {
  return {
    seasonId: "biobuzz",
    eventCode: "USWABON1",
    eventName: "Rookie Rumble",
    matchType: "Qualification",
    video: null,
    importedAt: new Date().toISOString(),
    scoresUpdatedAt: new Date().toISOString(),
    alliances: {
      red: { teams: [100, 200], score: 30, penaltyPoints: 0, difficulty: "easy" },
      blue: { teams: [300, 400], score: 90, penaltyPoints: 0, difficulty: "hard" },
    },
    ...overrides,
  };
}

function makeSession(overrides: Partial<PracticeSession>): PracticeSession {
  return {
    id: "PS-TEST01",
    teamId: "team-1",
    uid: "uid-1",
    scoutName: "Test Scout",
    kind: "solo",
    seasonId: "biobuzz",
    mode: "trial",
    difficulty: "easy",
    libraryMatchId: "USWABON1_Q1",
    eventCode: "USWABON1",
    alliance: "red",
    robots: [100, 200],
    status: "in-progress",
    completedRobots: [],
    entryIds: [],
    accuracy: null,
    scoutedTotal: null,
    penaltyPoints: null,
    officialScore: null,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    ...overrides,
  };
}

describe("buildMatchRows", () => {
  it("produces one row per alliance that matches the chosen difficulty", () => {
    const match = makeMatch({ id: "USWABON1_Q1", matchNumber: 1 });
    const rows = buildMatchRows([match], [], "uid-1", "easy");
    expect(rows).toHaveLength(1);
    expect(rows[0].alliance).toBe("red");

    const hardRows = buildMatchRows([match], [], "uid-1", "hard");
    expect(hardRows).toHaveLength(1);
    expect(hardRows[0].alliance).toBe("blue");
  });

  it("marks a row Fresh when no session references it", () => {
    const match = makeMatch({ id: "USWABON1_Q1", matchNumber: 1 });
    const rows = buildMatchRows([match], [], "uid-1", "easy");
    expect(rows[0].status).toBe("fresh");
    expect(rows[0].byYou).toBe(false);
  });

  it("marks a row Opened when an in-progress/paused session references it, Scouted beats Opened", () => {
    const match = makeMatch({ id: "USWABON1_Q1", matchNumber: 1 });
    const inProgress = makeSession({ libraryMatchId: "USWABON1_Q1", alliance: "red", status: "in-progress", uid: "uid-2" });
    const opened = buildMatchRows([match], [inProgress], "uid-1", "easy");
    expect(opened[0].status).toBe("opened");
    expect(opened[0].byYou).toBe(false);

    const completed = makeSession({ libraryMatchId: "USWABON1_Q1", alliance: "red", status: "completed", uid: "uid-1" });
    const scouted = buildMatchRows([match], [inProgress, completed], "uid-1", "easy");
    expect(scouted[0].status).toBe("scouted");
    expect(scouted[0].byYou).toBe(true);
  });

  it("never includes the official score or penalty points in a row", () => {
    const match = makeMatch({ id: "USWABON1_Q1", matchNumber: 1 });
    const rows = buildMatchRows([match], [], "uid-1", "easy");
    expect(rows[0]).not.toHaveProperty("score");
    expect(rows[0]).not.toHaveProperty("penaltyPoints");
  });
});

describe("sortMatchRows", () => {
  it("sorts Fresh before Opened before Scouted, then by match number within each group", () => {
    const rows: MatchRow[] = [
      { libraryMatchId: "a", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 5, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "scouted", byYou: false },
      { libraryMatchId: "b", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 2, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "fresh", byYou: false },
      { libraryMatchId: "c", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 1, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "fresh", byYou: false },
      { libraryMatchId: "d", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 3, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "opened", byYou: false },
    ];
    const sorted = sortMatchRows(rows);
    expect(sorted.map((r) => r.libraryMatchId)).toEqual(["c", "b", "d", "a"]);
  });
});

describe("pickRandomMatchRow", () => {
  it("prefers Fresh rows", () => {
    const rows: MatchRow[] = [
      { libraryMatchId: "scouted", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 1, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "scouted", byYou: false },
      { libraryMatchId: "fresh", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 2, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "fresh", byYou: false },
    ];
    for (let i = 0; i < 10; i++) {
      expect(pickRandomMatchRow(rows)?.libraryMatchId).toBe("fresh");
    }
  });

  it("falls back to Opened, then Scouted, if nothing is Fresh", () => {
    const openedOnly: MatchRow[] = [
      { libraryMatchId: "opened", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 1, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "opened", byYou: false },
    ];
    expect(pickRandomMatchRow(openedOnly)?.libraryMatchId).toBe("opened");

    const scoutedOnly: MatchRow[] = [
      { libraryMatchId: "scouted", eventCode: "USWABON1", matchType: "Qualification", matchNumber: 1, alliance: "red", teams: [], difficulty: "easy", hasVideo: true, status: "scouted", byYou: false },
    ];
    expect(pickRandomMatchRow(scoutedOnly)?.libraryMatchId).toBe("scouted");
  });

  it("returns null when there are no rows", () => {
    expect(pickRandomMatchRow([])).toBeNull();
  });
});
