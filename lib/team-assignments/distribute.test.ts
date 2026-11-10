import { describe, expect, it } from "vitest";
import { assignmentProgress, countsOf, distributeTeams, isUneven, scoutsNeeded, setTeamLocked, setTeamScouts, teamsForScout, unassignedTeams, type DistributeSettings, type TeamAssignRow } from "@/lib/team-assignments/distribute";

const teams = (n: number, start = 100) => Array.from({ length: n }, (_, i) => start + i);
const base = (over: Partial<DistributeSettings> = {}): DistributeSettings => ({ teams: teams(30), scoutUids: ["a", "b", "c", "d", "e"], mode: "balanced-random", priorityTeams: [], priorityCoverage: 2, locked: [], seed: 1, ...over });
const spread = (c: Record<string, number>) => Math.max(...Object.values(c)) - Math.min(...Object.values(c));

describe("balanced random", () => {
  it("gives every team exactly one scout and keeps the counts within one of each other, for any seed and any split", () => {
    for (let seed = 0; seed < 60; seed++) {
      for (const [n, s] of [[30, 5], [31, 5], [7, 3], [13, 6], [5, 5], [3, 5]] as const) {
        const r = distributeTeams(base({ teams: teams(n), scoutUids: Array.from({ length: s }, (_, i) => `s${i}`), seed }));
        expect(r.rows).toHaveLength(n);
        expect(r.rows.every((x) => x.scoutUids.length === 1), `${n}/${s}/${seed}`).toBe(true);
        expect(spread(r.counts), `${n}/${s}/${seed}`).toBeLessThanOrEqual(1);
        expect(r.uneven).toBe(false);
        expect(Object.values(r.counts).reduce((a, b) => a + b, 0)).toBe(n);
      }
    }
  });

  it("is reproducible for a seed and different for another", () => {
    const a = distributeTeams(base({ seed: 7 })).rows.map((r) => r.scoutUids[0]);
    expect(distributeTeams(base({ seed: 7 })).rows.map((r) => r.scoutUids[0])).toEqual(a);
    expect(distributeTeams(base({ seed: 8 })).rows.map((r) => r.scoutUids[0])).not.toEqual(a);
  });

  it("ignores duplicate teams and scouts, sorts rows by team number", () => {
    const r = distributeTeams(base({ teams: [300, 100, 100, 200], scoutUids: ["a", "a", "b"] }));
    expect(r.rows.map((x) => x.teamNumber)).toEqual([100, 200, 300]);
    expect(Object.keys(r.counts)).toEqual(["a", "b"]);
  });
});

describe("priority teams and coverage", () => {
  const priority = [100, 105, 110];

  it("coverage 2: each priority team gets two different scouts, the rest one", () => {
    for (let seed = 0; seed < 30; seed++) {
      const r = distributeTeams(base({ priorityTeams: priority, priorityCoverage: 2, seed }));
      for (const row of r.rows) {
        expect(row.scoutUids).toHaveLength(priority.includes(row.teamNumber) ? 2 : 1);
        expect(new Set(row.scoutUids).size).toBe(row.scoutUids.length);
      }
      expect(spread(r.counts), String(seed)).toBeLessThanOrEqual(1);
    }
  });

  it("coverage 1: priority teams get one scout like everyone else", () => {
    const r = distributeTeams(base({ priorityTeams: priority, priorityCoverage: 1 }));
    expect(r.rows.every((x) => x.scoutUids.length === 1)).toBe(true);
  });

  it("never asks for more scouts than there are, and says so", () => {
    expect(scoutsNeeded(1, new Set([1]), 2, 1)).toBe(1);
    expect(scoutsNeeded(2, new Set([1]), 2, 5)).toBe(1);
    expect(scoutsNeeded(1, new Set([1]), 2, 0)).toBe(0);
    const r = distributeTeams(base({ scoutUids: ["a"], priorityTeams: priority }));
    expect(r.rows.every((x) => x.scoutUids.length === 1)).toBe(true);
    expect(r.warning).toMatch(/Only one scout/);
  });
});

describe("sequential blocks", () => {
  it("cuts the sorted teams into contiguous blocks, one per scout in order, sizes within one", () => {
    const r = distributeTeams(base({ mode: "sequential-blocks", teams: [140, 101, 130, 120, 110, 105, 150], scoutUids: ["a", "b", "c"] }));
    expect(r.rows.map((x) => [x.teamNumber, x.scoutUids[0]])).toEqual([[101, "a"], [105, "a"], [110, "a"], [120, "b"], [130, "b"], [140, "c"], [150, "c"]]);
    expect(r.counts).toEqual({ a: 3, b: 2, c: 2 });
  });

  it("is the same whatever the seed", () => {
    const a = distributeTeams(base({ mode: "sequential-blocks", seed: 1 })).rows;
    expect(distributeTeams(base({ mode: "sequential-blocks", seed: 99 })).rows).toEqual(a);
  });

  it("adds a priority team's second scout from the least loaded other scout, and keeps the loads close", () => {
    const r = distributeTeams(base({ mode: "sequential-blocks", priorityTeams: [100, 129], priorityCoverage: 2 }));
    for (const t of [100, 129]) {
      const row = r.rows.find((x) => x.teamNumber === t)!;
      expect(row.scoutUids).toHaveLength(2);
      expect(row.scoutUids[0]).not.toBe(row.scoutUids[1]);
    }
    expect(spread(r.counts)).toBeLessThanOrEqual(1);
  });
});

describe("locked assignments survive a re-roll", () => {
  const locked: TeamAssignRow[] = [{ teamNumber: 100, scoutUids: ["a"], locked: true }, { teamNumber: 101, scoutUids: ["a", "b"], locked: true }];

  it("keeps them exactly, counts them toward the load, and spreads the rest around them", () => {
    for (const mode of ["balanced-random", "sequential-blocks"] as const) {
      for (let seed = 0; seed < 20; seed++) {
        const r = distributeTeams(base({ mode, locked, seed }));
        expect(r.rows.find((x) => x.teamNumber === 100)).toEqual({ teamNumber: 100, scoutUids: ["a"], locked: true });
        expect(r.rows.find((x) => x.teamNumber === 101)?.scoutUids).toEqual(["a", "b"]);
        expect(r.rows.filter((x) => x.locked)).toHaveLength(2);
        // 30 teams + 1 extra coverage on 101 = 31 slots over 5 scouts: 6 or 7 each
        expect(spread(r.counts), `${mode}/${seed}`).toBeLessThanOrEqual(1);
      }
    }
  });

  it("drops a locked scout who left the pool; a locked team with nobody left is re-rolled; a locked team outside the list is ignored", () => {
    const r = distributeTeams(base({ scoutUids: ["b", "c"], teams: [100, 101, 102], locked: [{ teamNumber: 100, scoutUids: ["a"], locked: true }, { teamNumber: 101, scoutUids: ["a", "b"], locked: true }, { teamNumber: 999, scoutUids: ["b"], locked: true }] }));
    expect(r.rows.find((x) => x.teamNumber === 101)).toEqual({ teamNumber: 101, scoutUids: ["b"], locked: true });
    expect(r.rows.find((x) => x.teamNumber === 100)?.locked).toBe(false);
    expect(r.rows.map((x) => x.teamNumber)).toEqual([100, 101, 102]);
  });

  it("warns when locks make it uneven, and says by how much", () => {
    const heavy: TeamAssignRow[] = teams(10).map((t) => ({ teamNumber: t, scoutUids: ["a"], locked: true }));
    const r = distributeTeams(base({ teams: teams(14), scoutUids: ["a", "b"], locked: heavy }));
    expect(r.uneven).toBe(true);
    expect(r.counts).toEqual({ a: 10, b: 4 });
    expect(r.warning).toMatch(/Uneven: 4 to 10 teams each/);
  });
});

describe("no scouts", () => {
  it("leaves every team unassigned and says why", () => {
    const r = distributeTeams(base({ scoutUids: [] }));
    expect(r.rows.every((x) => x.scoutUids.length === 0)).toBe(true);
    expect(r.warning).toMatch(/at least one scout/);
    expect(r.counts).toEqual({});
  });
});

describe("manual edits and reading a version", () => {
  const rows: TeamAssignRow[] = [{ teamNumber: 1, scoutUids: ["a"], locked: false }, { teamNumber: 2, scoutUids: ["b"], locked: false }, { teamNumber: 3, scoutUids: [], locked: false }];

  it("a manual change locks the row; clearing it unlocks", () => {
    const edited = setTeamScouts(rows, 1, ["b", "b", "c"]);
    expect(edited[0]).toEqual({ teamNumber: 1, scoutUids: ["b", "c"], locked: true });
    expect(setTeamScouts(edited, 1, [])[0]).toEqual({ teamNumber: 1, scoutUids: [], locked: false });
    expect(setTeamLocked(rows, 1, true)[0].locked).toBe(true);
    expect(setTeamLocked(rows, 3, true)[2].locked).toBe(false); // nothing to lock
    expect(setTeamLocked(setTeamLocked(rows, 1, true), 1, false)[0].locked).toBe(false);
  });

  it("totals, unevenness, who has which teams and who has none", () => {
    expect(countsOf(rows, ["a", "b", "c"])).toEqual({ a: 1, b: 1, c: 0 });
    expect(isUneven({ a: 5, b: 3 })).toBe(true);
    expect(isUneven({ a: 4, b: 3 })).toBe(false);
    expect(isUneven({})).toBe(false);
    expect(teamsForScout(rows, "b")).toEqual([2]);
    expect(unassignedTeams(rows)).toEqual([3]);
  });

  it("progress against the teams a person has an entry for", () => {
    expect(assignmentProgress([5, 3, 9, 1], new Set([3, 1, 77]))).toEqual({ done: 2, total: 4, remaining: [5, 9], percent: 50 });
    expect(assignmentProgress([], new Set([1]))).toEqual({ done: 0, total: 0, remaining: [], percent: null });
  });
});
