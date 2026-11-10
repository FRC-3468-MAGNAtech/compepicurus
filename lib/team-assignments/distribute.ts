import { mulberry32, seededShuffle } from "@/lib/scheduler/rng";

// P31: handing the event's teams out to scouts for the Pit Scout and Team Strategy forms. Pure, seedable, no Firebase. A team is one unit of work (unlike Match Scouting's
// per-match slots), so the job is "who covers which teams", balanced so no scout has more than one team more than another.

export type DistributeMode = "balanced-random" | "sequential-blocks";

/** One team and the scouts on it. `locked` rows were set by hand and survive a re-roll. */
export type TeamAssignRow = { teamNumber: number; scoutUids: string[]; locked: boolean };

export type DistributeSettings = {
  /** Every team to cover, in any order (duplicates ignored). Our own teams are removed by the caller (the page's toggle). */
  teams: readonly number[];
  /** The scouts to spread them over: the order matters only for sequential blocks. */
  scoutUids: readonly string[];
  mode: DistributeMode;
  /** These teams get `priorityCoverage` scouts, the rest get one. */
  priorityTeams: readonly number[];
  priorityCoverage: 1 | 2;
  /** Manual assignments to keep as they are (a locked team is not re-rolled, and counts toward its scouts' load). */
  locked: readonly TeamAssignRow[];
  seed: number;
};

export type DistributeResult = {
  /** One row per team, sorted by team number. */
  rows: TeamAssignRow[];
  /** Teams per scout, 0 included for a scout with none. */
  counts: Record<string, number>;
  /** The most-loaded scout has more than one team more than the least-loaded one. */
  uneven: boolean;
  warning: string | null;
};

const unique = <T,>(xs: readonly T[]): T[] => [...new Set(xs)];

/** How many scouts a team needs: priority teams get the chosen coverage (never more than there are scouts), the rest one. */
export function scoutsNeeded(team: number, priority: ReadonlySet<number>, coverage: 1 | 2, scoutCount: number): number {
  return Math.max(0, Math.min(scoutCount, priority.has(team) ? coverage : 1));
}

export function countsOf(rows: readonly Pick<TeamAssignRow, "scoutUids">[], scoutUids: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(scoutUids.map((u) => [u, 0]));
  for (const r of rows) for (const u of r.scoutUids) if (u in counts) counts[u] += 1;
  return counts;
}

/** Loads differing by more than one team. */
export function isUneven(counts: Readonly<Record<string, number>>): boolean {
  const values = Object.values(counts);
  return values.length > 0 && Math.max(...values) - Math.min(...values) > 1;
}

const describeLoad = (counts: Readonly<Record<string, number>>): string => {
  const values = Object.values(counts);
  return `${Math.min(...values)} to ${Math.max(...values)} teams each`;
};

/**
 * Hands the teams out.
 *  - **balanced-random**: priority teams first, then the rest, each team in a random order; every team goes to the scout(s) with the fewest teams so far (ties broken
 *    at random). With nothing locked the counts differ by at most one.
 *  - **sequential-blocks**: the unlocked teams sorted by number are cut into contiguous blocks, one block per scout in the given scout order, block sizes differing by
 *    at most one; a priority team's second scout is then the least-loaded other scout (the first in the scout order on a tie).
 * A locked row is kept exactly (minus any scout who is no longer in the pool) and counts toward that scout's load. A locked team with no scout left is re-rolled.
 */
export function distributeTeams(settings: DistributeSettings): DistributeResult {
  const scouts = unique(settings.scoutUids);
  const teams = unique(settings.teams).sort((a, b) => a - b);
  const teamSet = new Set(teams);
  const priority = new Set(settings.priorityTeams);
  const pool = new Set(scouts);

  const kept = new Map<number, TeamAssignRow>();
  for (const l of settings.locked) {
    if (!teamSet.has(l.teamNumber)) continue;
    const members = unique(l.scoutUids).filter((u) => pool.has(u));
    if (members.length > 0) kept.set(l.teamNumber, { teamNumber: l.teamNumber, scoutUids: members, locked: true });
  }

  const counts: Record<string, number> = Object.fromEntries(scouts.map((u) => [u, 0]));
  for (const r of kept.values()) for (const u of r.scoutUids) counts[u] += 1;

  const open = teams.filter((t) => !kept.has(t));
  const out = new Map<number, TeamAssignRow>(kept);

  if (scouts.length === 0) {
    for (const t of open) out.set(t, { teamNumber: t, scoutUids: [], locked: false });
    return finish(out, scouts, "Pick at least one scout to hand teams out to.");
  }

  const rng = mulberry32(settings.seed);
  const place = (team: number, uids: string[]) => {
    out.set(team, { teamNumber: team, scoutUids: uids, locked: false });
    for (const u of uids) counts[u] += 1;
  };
  /** The `n` least-loaded scouts not in `except`, ties broken by `tie` (a per-scout rank). */
  const leastLoaded = (n: number, except: readonly string[], tie: ReadonlyMap<string, number>): string[] =>
    scouts
      .filter((u) => !except.includes(u))
      .sort((a, b) => counts[a] - counts[b] || (tie.get(a) ?? 0) - (tie.get(b) ?? 0))
      .slice(0, n);

  if (settings.mode === "balanced-random") {
    const order = [...seededShuffle(open.filter((t) => priority.has(t)), rng), ...seededShuffle(open.filter((t) => !priority.has(t)), rng)];
    for (const team of order) {
      const tie = new Map(seededShuffle(scouts, rng).map((u, i) => [u, i]));
      place(team, leastLoaded(scoutsNeeded(team, priority, settings.priorityCoverage, scouts.length), [], tie));
    }
  } else {
    // block sizes: give each team to whichever scout has the lowest load so far (locked included), earliest scout first on a tie; the sizes then lay out as blocks
    const size: Record<string, number> = Object.fromEntries(scouts.map((u) => [u, 0]));
    for (let i = 0; i < open.length; i++) {
      const next = [...scouts].sort((a, b) => counts[a] + size[a] - (counts[b] + size[b]) || scouts.indexOf(a) - scouts.indexOf(b))[0];
      size[next] += 1;
    }
    let at = 0;
    const primary = new Map<number, string>();
    for (const u of scouts) for (let i = 0; i < size[u]; i++) primary.set(open[at++], u);
    for (const team of open) counts[primary.get(team)!] += 1;
    const order = new Map(scouts.map((u, i) => [u, i]));
    for (const team of open) {
      const first = primary.get(team)!;
      const extra = scoutsNeeded(team, priority, settings.priorityCoverage, scouts.length) - 1;
      const more = extra > 0 ? leastLoaded(extra, [first], order) : [];
      for (const u of more) counts[u] += 1;
      out.set(team, { teamNumber: team, scoutUids: [first, ...more], locked: false });
    }
  }

  return finish(out, scouts, priority.size > 0 && settings.priorityCoverage === 2 && scouts.length < 2 ? "Only one scout: priority teams can't be covered twice." : null);
}

function finish(out: Map<number, TeamAssignRow>, scouts: readonly string[], base: string | null): DistributeResult {
  const rows = [...out.values()].sort((a, b) => a.teamNumber - b.teamNumber);
  const counts = countsOf(rows, scouts);
  const uneven = isUneven(counts);
  const warning = base ?? (uneven ? `Uneven: ${describeLoad(counts)}. Locked teams or double coverage can cause this; move a team to even it out.` : null);
  return { rows, counts, uneven, warning };
}

// --- manual edits and reading a published version ------------------------------------------------------------------

/** Sets one team's scouts by hand. The row becomes locked, so a re-roll keeps it. An empty list leaves the team unassigned (and unlocked). */
export function setTeamScouts(rows: readonly TeamAssignRow[], teamNumber: number, scoutUids: readonly string[]): TeamAssignRow[] {
  const uids = unique(scoutUids);
  return rows.map((r) => (r.teamNumber === teamNumber ? { ...r, scoutUids: uids, locked: uids.length > 0 } : r));
}

export function setTeamLocked(rows: readonly TeamAssignRow[], teamNumber: number, locked: boolean): TeamAssignRow[] {
  return rows.map((r) => (r.teamNumber === teamNumber ? { ...r, locked: locked && r.scoutUids.length > 0 } : r));
}

/** The teams a person is assigned, sorted. */
export const teamsForScout = (rows: readonly Pick<TeamAssignRow, "teamNumber" | "scoutUids">[], uid: string): number[] => rows.filter((r) => r.scoutUids.includes(uid)).map((r) => r.teamNumber).sort((a, b) => a - b);

/** Teams with nobody on them. */
export const unassignedTeams = (rows: readonly Pick<TeamAssignRow, "teamNumber" | "scoutUids">[]): number[] => rows.filter((r) => r.scoutUids.length === 0).map((r) => r.teamNumber);

/** "7 of 12 done": a person's assigned teams against the teams they have an entry for. `remaining` is what is left, in order. */
export function assignmentProgress(assigned: readonly number[], done: ReadonlySet<number>): { done: number; total: number; remaining: number[]; percent: number | null } {
  const total = assigned.length;
  const d = assigned.filter((t) => done.has(t)).length;
  return { done: d, total, remaining: assigned.filter((t) => !done.has(t)), percent: total === 0 ? null : Math.round((d / total) * 100) };
}
