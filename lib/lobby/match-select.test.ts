import { describe, expect, it } from "vitest";
import { sortMatchesByDifficultyTarget, pickRandomLobbyMatch } from "./match-select";
import type { Difficulty } from "@/lib/difficulty";
import type { LibraryMatch } from "@/lib/match-library";

function match(id: string, matchNumber: number, red: Difficulty, blue: Difficulty): LibraryMatch {
  return {
    id,
    seasonId: "biobuzz",
    eventCode: "USWABON1",
    eventName: "Rookie Rumble",
    matchType: "Qualification",
    matchNumber,
    alliances: {
      red: { teams: [1, 2], score: 0, penaltyPoints: 0, difficulty: red },
      blue: { teams: [3, 4], score: 0, penaltyPoints: 0, difficulty: blue },
    },
    video: null,
    importedAt: "2026-01-01T00:00:00.000Z",
    scoresUpdatedAt: "2026-01-01T00:00:00.000Z",
  };
}

describe("sortMatchesByDifficultyTarget", () => {
  it("easy target: both-easy, then easy+medium, then easy+hard, then neither", () => {
    const matches = [
      match("hard-hard", 1, "hard", "hard"),
      match("easy-hard", 2, "easy", "hard"),
      match("easy-medium", 3, "easy", "medium"),
      match("easy-easy", 4, "easy", "easy"),
      match("medium-hard", 5, "medium", "hard"),
    ];
    const sorted = sortMatchesByDifficultyTarget(matches, "easy");
    expect(sorted.map((m) => m.id)).toEqual(["easy-easy", "easy-medium", "easy-hard", "hard-hard", "medium-hard"]);
  });

  it("hard target: both-hard, then hard+medium, then hard+easy, then neither", () => {
    const matches = [
      match("easy-easy", 1, "easy", "easy"),
      match("hard-easy", 2, "hard", "easy"),
      match("hard-medium", 3, "hard", "medium"),
      match("hard-hard", 4, "hard", "hard"),
    ];
    const sorted = sortMatchesByDifficultyTarget(matches, "hard");
    expect(sorted.map((m) => m.id)).toEqual(["hard-hard", "hard-medium", "hard-easy", "easy-easy"]);
  });

  it("medium target: both-medium, then medium+easy, then medium+hard", () => {
    const matches = [
      match("medium-hard", 1, "medium", "hard"),
      match("medium-easy", 2, "medium", "easy"),
      match("medium-medium", 3, "medium", "medium"),
    ];
    const sorted = sortMatchesByDifficultyTarget(matches, "medium");
    expect(sorted.map((m) => m.id)).toEqual(["medium-medium", "medium-easy", "medium-hard"]);
  });

  it("ties within a tier break by match number", () => {
    const matches = [match("b", 7, "easy", "easy"), match("a", 2, "easy", "easy")];
    const sorted = sortMatchesByDifficultyTarget(matches, "easy");
    expect(sorted.map((m) => m.id)).toEqual(["a", "b"]);
  });
});

describe("pickRandomLobbyMatch", () => {
  it("returns null for an empty pool", () => {
    expect(pickRandomLobbyMatch([])).toBeNull();
  });

  it("picks a match from the pool", () => {
    const matches = [match("a", 1, "easy", "easy"), match("b", 2, "medium", "medium")];
    const picked = pickRandomLobbyMatch(matches);
    expect(matches).toContain(picked);
  });
});
