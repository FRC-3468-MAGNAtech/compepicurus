import { seededShuffle } from "@/lib/scheduler/rng";
import type { AllianceColor } from "@/lib/practice-sessions";

export type PairAssignment = {
  pairId: string;
  playerUids: [string, string];
  alliance: AllianceColor;
  /** Which of the alliance's two team numbers each player in the pair scouts. */
  robotForUid: Record<string, number>;
};

/**
 * Random pairing per the P8 spec: shuffle players, chunk into pairs,
 * alliances alternate red/blue/red/blue... across pairs in shuffled order
 * (so with more than 2 pairs, several end up on the same alliance — each
 * still gets its own independent result), and within a pair the alliance's
 * two team numbers are randomly split between its two players. Requires an
 * even `playerUids.length` of at least 4 — the caller (the Start button)
 * already guarantees this; an odd leftover player is silently left
 * unpaired rather than this function inventing a rule the spec never gave.
 */
export function assignPairs(
  playerUids: string[],
  allianceTeams: { red: [number, number]; blue: [number, number] },
  rng: () => number
): PairAssignment[] {
  const shuffled = seededShuffle(playerUids, rng);
  const pairs: PairAssignment[] = [];

  for (let i = 0; i + 1 < shuffled.length; i += 2) {
    const pairIndex = i / 2;
    const alliance: AllianceColor = pairIndex % 2 === 0 ? "red" : "blue";
    const [playerA, playerB] = [shuffled[i], shuffled[i + 1]];
    const [teamA, teamB] = allianceTeams[alliance];
    const robotForUid =
      rng() < 0.5 ? { [playerA]: teamA, [playerB]: teamB } : { [playerA]: teamB, [playerB]: teamA };
    pairs.push({ pairId: `pair-${pairIndex + 1}`, playerUids: [playerA, playerB], alliance, robotForUid });
  }

  return pairs;
}
