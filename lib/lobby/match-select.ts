import type { Difficulty } from "@/lib/difficulty";
import type { LibraryMatch } from "@/lib/match-library";

/**
 * The host's "Pick Match" sort order from the P8 spec, keyed by the target
 * difficulty they chose: both alliances matching the target sort first,
 * then one alliance matching (ties broken by what the *other* alliance is,
 * per the spec's own order), then — not specified by the prompt, since its
 * three tiers only ever name combinations that include the target — any
 * match where *neither* alliance matches the target sorts last of all (see
 * docs/ASSUMPTIONS.md, P8).
 */
const OTHER_ALLIANCE_ORDER: Record<Difficulty, [Difficulty, Difficulty]> = {
  easy: ["medium", "hard"],
  hard: ["medium", "easy"],
  medium: ["easy", "hard"],
};

function tierFor(match: LibraryMatch, target: Difficulty): number {
  const redD = match.alliances.red.difficulty;
  const blueD = match.alliances.blue.difficulty;
  const matchCount = [redD, blueD].filter((d) => d === target).length;
  if (matchCount === 2) return 0;
  if (matchCount === 0) return 3;
  const other = redD === target ? blueD : redD;
  const [second, third] = OTHER_ALLIANCE_ORDER[target];
  return other === second ? 1 : other === third ? 2 : 3;
}

/** Sorted by the difficulty-combination tiers above; ties by match number. */
export function sortMatchesByDifficultyTarget(matches: LibraryMatch[], target: Difficulty): LibraryMatch[] {
  return [...matches].sort((a, b) => tierFor(a, target) - tierFor(b, target) || a.matchNumber - b.matchNumber);
}

/** Uniform-random pick from whatever pool the caller already filtered to "playable" (has video, or the team's placeholder setting is on) — the host's default "random match, any difficulty" per the spec. */
export function pickRandomLobbyMatch(matches: LibraryMatch[]): LibraryMatch | null {
  if (matches.length === 0) return null;
  return matches[Math.floor(Math.random() * matches.length)];
}
