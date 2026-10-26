import type { FtcMatch } from "@/lib/ftc/types";
import type { LibraryMatch } from "@/lib/match-library";
import type { Difficulty } from "@/lib/difficulty";
import type { MatchInput } from "./types";

/** An "Event schedule"/"Live" match source — skips matches without exactly 2 teams per alliance, same convention as `lib/match-library.ts`'s import. */
export function ftcMatchesToInputs(matches: FtcMatch[]): MatchInput[] {
  return matches
    .filter((m) => m.redTeams.length === 2 && m.blueTeams.length === 2)
    .map((m) => ({
      matchType: m.type,
      matchNumber: m.matchNumber,
      red: [m.redTeams[0], m.redTeams[1]] as [number, number],
      blue: [m.blueTeams[0], m.blueTeams[1]] as [number, number],
    }));
}

/** A "Practice library" match source, scoped to one difficulty — only the alliance(s) actually matching `difficulty` get slots; the other alliance (if it doesn't match) is left out entirely, not generated as unassignable slots. */
export function libraryMatchesToInputs(matches: LibraryMatch[], difficulty: Difficulty): MatchInput[] {
  return matches
    .map((m) => ({
      matchType: m.matchType,
      matchNumber: m.matchNumber,
      red: m.alliances.red.difficulty === difficulty ? (m.alliances.red.teams as [number, number]) : null,
      blue: m.alliances.blue.difficulty === difficulty ? (m.alliances.blue.teams as [number, number]) : null,
    }))
    .filter((m) => m.red !== null || m.blue !== null);
}
