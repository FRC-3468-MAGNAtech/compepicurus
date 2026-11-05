import { rankWithTies } from "@/lib/accuracy/engine";
import { pickLikelihood } from "@/lib/pickLikelihood";
import type { FtcRanking } from "@/lib/ftc/types";
import type { TeamStats } from "@/lib/analytics/team-stats";

// Pure row model for the Pick List board (P12): one row per team in the event,
// joining official data (O. columns — never touched by the accuracy filter) and
// scouted data (S. columns — which follow the shared Analytics filters).

export type PickRow = {
  teamNumber: number;
  teamName: string | null;
  /** Official qualification rank, or null before rankings exist / for an unranked team. */
  oRank: number | null;
  record: { wins: number; losses: number; ties: number } | null;
  rankingPoints: number | null;
  /** Rank by scouted average total (`rankWithTies`: 1, 2, 2, 4), or null with no scouted data. */
  sRank: number | null;
  /** Average scouted total score. */
  sAvg: number | null;
  /** Highest scouted total in a single match. */
  sHigh: number | null;
  /** Calculated from official scores only; null when off or the team has no official matches. */
  epa: number | null;
  /** Estimated probability (0-1) we can pick this team — see lib/pickLikelihood. */
  pickPct: number | null;
};

export type PickBoard = {
  /** Everyone except our own team. */
  rows: PickRow[];
  /** Our own team, pinned in the header — never in the lists. Null if our number isn't known. */
  ours: PickRow | null;
  /** Teams in the field, for the Pick % scale. */
  teamCount: number;
};

export function buildPickBoard(input: {
  /** Every team in the event (team list ∪ rankings ∪ scouted teams). */
  teamNumbers: number[];
  teamNames: ReadonlyMap<number, string>;
  rankings: FtcRanking[];
  /** Per-team scouted stats from the filtered entries (accuracy filter applied). */
  teamStats: TeamStats[];
  /** Team → EPA, or null when the EPA column is off. */
  epa: ReadonlyMap<number, number> | null;
  ourTeamNumber: number | null;
}): PickBoard {
  const field = [...new Set(input.teamNumbers)].sort((a, b) => a - b);
  const rankingBy = new Map(input.rankings.map((r) => [r.teamNumber, r]));
  const statsBy = new Map(input.teamStats.map((s) => [s.teamNumber, s]));

  // S. Rank is over the whole field (our team included) so it's the same number our header card shows.
  const sRanks = new Map(
    rankWithTies(field, (t) => {
      const s = statsBy.get(t);
      return s && s.entryCount > 0 ? Math.round(s.avgTotal * 100) / 100 : null;
    }).map(({ item, rank }) => [item, rank])
  );

  const ourRank = input.ourTeamNumber === null ? null : (rankingBy.get(input.ourTeamNumber)?.rank ?? null);
  const teamCount = Math.max(field.length, input.rankings.length);

  const rowFor = (teamNumber: number): PickRow => {
    const official = rankingBy.get(teamNumber);
    const stats = statsBy.get(teamNumber);
    const scouted = stats && stats.entryCount > 0 ? stats : null;
    const oRank = official?.rank ?? null;
    return {
      teamNumber,
      teamName: input.teamNames.get(teamNumber) ?? null,
      oRank,
      record: official ? { wins: official.wins, losses: official.losses, ties: official.ties } : null,
      rankingPoints: official?.rankingPoints ?? null,
      sRank: sRanks.get(teamNumber) ?? null,
      sAvg: scouted ? scouted.avgTotal : null,
      sHigh: scouted ? scouted.highTotal : null,
      epa: input.epa?.get(teamNumber) ?? null,
      pickPct: pickLikelihood(oRank, ourRank, teamCount),
    };
  };

  return {
    rows: field.filter((t) => t !== input.ourTeamNumber).map(rowFor),
    ours: input.ourTeamNumber === null ? null : rowFor(input.ourTeamNumber),
    teamCount,
  };
}

export type PickSortKey = "oRank" | "sRank" | "sAvg" | "sHigh" | "epa" | "pickPct";

/** Label, and whether best = lowest number (ranks) or highest (scores, EPA, Pick %). */
export const PICK_SORTS: { key: PickSortKey; label: string; lowestFirst: boolean }[] = [
  { key: "oRank", label: "O. Rank", lowestFirst: true },
  { key: "sRank", label: "S. Rank", lowestFirst: true },
  { key: "sAvg", label: "S. Avg", lowestFirst: false },
  { key: "sHigh", label: "S. High", lowestFirst: false },
  { key: "epa", label: "O. EPA", lowestFirst: false },
  { key: "pickPct", label: "Pick %", lowestFirst: false },
];

/** Best first; teams with no value always last; ties (and the unranked) by team number. Never mutates. */
export function sortPickRows(rows: PickRow[], key: PickSortKey): PickRow[] {
  const lowestFirst = PICK_SORTS.find((s) => s.key === key)!.lowestFirst;
  return [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null && bv === null) return a.teamNumber - b.teamNumber;
    if (av === null) return 1;
    if (bv === null) return -1;
    const diff = lowestFirst ? av - bv : bv - av;
    return diff || a.teamNumber - b.teamNumber;
  });
}

export function pickRowMatches(row: Pick<PickRow, "teamNumber" | "teamName">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || String(row.teamNumber).includes(q) || (row.teamName ?? "").toLowerCase().includes(q);
}
