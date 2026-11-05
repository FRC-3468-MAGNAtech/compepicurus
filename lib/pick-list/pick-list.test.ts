import { describe, expect, it } from "vitest";
import type { FtcRanking } from "@/lib/ftc/types";
import type { TeamStats } from "@/lib/analytics/team-stats";
import { MAX_PICKS, applyPickOp, placeOpFromList, samePicks, sanitizePicks, type PickOp } from "./ops";
import { PICK_LIST_EDITOR_ROLES, canEditPickList } from "./permissions";
import { buildPickBoard, pickRowMatches, sortPickRows, type PickRow } from "./rows";

describe("applyPickOp", () => {
  it("places a new team at the end, or before a named team", () => {
    expect(applyPickOp([1, 2], { type: "place", team: 3, before: null })).toEqual([1, 2, 3]);
    expect(applyPickOp([1, 2], { type: "place", team: 3, before: 2 })).toEqual([1, 3, 2]);
    expect(applyPickOp([1, 2], { type: "place", team: 3, before: 1 })).toEqual([3, 1, 2]);
  });

  it("falls back to the end when the 'before' team has gone", () => {
    expect(applyPickOp([1, 2], { type: "place", team: 3, before: 99 })).toEqual([1, 2, 3]);
  });

  it("moves a team that's already picked, never duplicating it", () => {
    expect(applyPickOp([1, 2, 3], { type: "place", team: 3, before: 1 })).toEqual([3, 1, 2]);
    expect(applyPickOp([1, 2, 3], { type: "place", team: 1, before: null })).toEqual([2, 3, 1]);
    expect(applyPickOp([1, 2, 3], { type: "place", team: 2, before: 2 })).toEqual([1, 3, 2]); // before itself = end
  });

  it("removes a team (and is a no-op for one that isn't there)", () => {
    expect(applyPickOp([1, 2, 3], { type: "remove", team: 2 })).toEqual([1, 3]);
    expect(applyPickOp([1, 2, 3], { type: "remove", team: 9 })).toEqual([1, 2, 3]);
  });

  it("moves up and down by one, stopping at the ends", () => {
    expect(applyPickOp([1, 2, 3], { type: "move", team: 2, delta: -1 })).toEqual([2, 1, 3]);
    expect(applyPickOp([1, 2, 3], { type: "move", team: 2, delta: 1 })).toEqual([1, 3, 2]);
    expect(applyPickOp([1, 2, 3], { type: "move", team: 1, delta: -1 })).toEqual([1, 2, 3]);
    expect(applyPickOp([1, 2, 3], { type: "move", team: 3, delta: 1 })).toEqual([1, 2, 3]);
    expect(applyPickOp([1, 2, 3], { type: "move", team: 9, delta: 1 })).toEqual([1, 2, 3]);
  });

  it("resets", () => {
    expect(applyPickOp([1, 2, 3], { type: "reset" })).toEqual([]);
  });

  it("never mutates its input", () => {
    const base = [1, 2, 3];
    for (const op of [{ type: "place", team: 4, before: 1 }, { type: "remove", team: 2 }, { type: "move", team: 3, delta: -1 }, { type: "reset" }] as PickOp[]) {
      applyPickOp(base, op);
    }
    expect(base).toEqual([1, 2, 3]);
  });

  it("caps the list", () => {
    const full = Array.from({ length: MAX_PICKS }, (_, i) => i + 1);
    expect(applyPickOp(full, { type: "place", team: 999, before: null })).toHaveLength(MAX_PICKS);
  });
});

describe("concurrent edits compose (why ops, not arrays, are what gets written)", () => {
  it("two people each add a different team to the same stored list: both survive", () => {
    const stored = [10, 20];
    // Alice and Bob both loaded [10, 20]. Each transaction re-applies its op to whatever is stored when it commits.
    const afterAlice = applyPickOp(stored, { type: "place", team: 30, before: null });
    const afterBob = applyPickOp(afterAlice, { type: "place", team: 40, before: null });
    expect(afterBob).toEqual([10, 20, 30, 40]);
  });

  it("a stale 'write back my array' would have lost Alice's pick — the op doesn't", () => {
    const aliceView = [10, 20];
    const bobWriteBack = [...aliceView, 40]; // what the old approach would store
    const stored = [10, 20, 30]; // Alice's pick landed first
    expect(bobWriteBack).not.toContain(30);
    expect(applyPickOp(stored, { type: "place", team: 40, before: null })).toContain(30);
  });

  it("one removes while another reorders: the removal and the reorder both apply", () => {
    let stored = [1, 2, 3, 4];
    stored = applyPickOp(stored, { type: "remove", team: 2 });
    stored = applyPickOp(stored, { type: "place", team: 4, before: 1 });
    expect(stored).toEqual([4, 1, 3]);
  });

  it("an op for a team someone else already removed is harmless", () => {
    expect(applyPickOp([1, 3], { type: "move", team: 2, delta: -1 })).toEqual([1, 3]);
  });
});

describe("placeOpFromList / samePicks / sanitizePicks", () => {
  it("turns a finished drag into 'before whatever now follows it'", () => {
    expect(placeOpFromList([3, 1, 2], 3)).toEqual({ type: "place", team: 3, before: 1 });
    expect(placeOpFromList([1, 2, 3], 3)).toEqual({ type: "place", team: 3, before: null });
    expect(placeOpFromList([1, 2], 9)).toEqual({ type: "place", team: 9, before: null });
  });

  it("compares lists in order", () => {
    expect(samePicks([1, 2], [1, 2])).toBe(true);
    expect(samePicks([1, 2], [2, 1])).toBe(false);
    expect(samePicks([1], [1, 2])).toBe(false);
  });

  it("cleans an untrusted stored list", () => {
    expect(sanitizePicks([5, "x", 5, 0, -3, 2.5, 7, null])).toEqual([5, 7]);
    expect(sanitizePicks("nope")).toEqual([]);
    expect(sanitizePicks(undefined)).toEqual([]);
  });
});

describe("canEditPickList", () => {
  const base = { isAdmin: false, primaryRole: "match-scout" as const, secondaryRoles: [] as never[] };

  it("lets admins edit, whatever their role", () => {
    expect(canEditPickList({ ...base, isAdmin: true })).toBe(true);
  });

  it("lets Lead Strategist, Lead Scout, Team Coach, and Drive Team edit as their PRIMARY role", () => {
    for (const role of PICK_LIST_EDITOR_ROLES) expect(canEditPickList({ ...base, primaryRole: role })).toBe(true);
  });

  it("…or as a SECONDARY role", () => {
    for (const role of PICK_LIST_EDITOR_ROLES) expect(canEditPickList({ ...base, secondaryRoles: [role] })).toBe(true);
  });

  it("is read-only for everyone else", () => {
    expect(canEditPickList(base)).toBe(false);
    expect(canEditPickList({ ...base, primaryRole: "pit-scout", secondaryRoles: ["media", "pit-team", "judge-awards"] })).toBe(false);
    expect(canEditPickList(null)).toBe(false);
    expect(canEditPickList(undefined)).toBe(false);
  });

  it("names exactly the four roles from the spec", () => {
    expect([...PICK_LIST_EDITOR_ROLES].sort()).toEqual(["drive-team", "lead-scout", "lead-strategist", "team-coach"]);
  });
});

// --- the board ---------------------------------------------------------------------

const ranking = (teamNumber: number, rank: number, extra: Partial<FtcRanking> = {}): FtcRanking => ({
  teamNumber,
  rank,
  wins: 3,
  losses: 1,
  ties: 0,
  matchesPlayed: 4,
  rankingPoints: 1.5,
  ...extra,
});

const stats = (teamNumber: number, avgTotal: number, highTotal: number, entryCount = 3): TeamStats => ({ teamNumber, avgTotal, highTotal, entryCount } as TeamStats);

describe("buildPickBoard", () => {
  const input = {
    teamNumbers: [3468, 100, 200, 300, 400],
    teamNames: new Map([[100, "Alpha"]]),
    rankings: [ranking(3468, 3), ranking(100, 1), ranking(200, 5), ranking(300, 9)],
    teamStats: [stats(100, 50, 70), stats(200, 80, 95), stats(3468, 65, 80)],
    epa: new Map([[100, 41.5], [200, 55]]) as ReadonlyMap<number, number>,
    ourTeamNumber: 3468,
  };
  const board = buildPickBoard(input);
  const row = (t: number) => board.rows.find((r) => r.teamNumber === t)!;

  it("excludes our team from the lists and pins it separately", () => {
    expect(board.rows.map((r) => r.teamNumber)).toEqual([100, 200, 300, 400]);
    expect(board.ours?.teamNumber).toBe(3468);
    expect(board.ours?.oRank).toBe(3);
    expect(board.ours?.record).toEqual({ wins: 3, losses: 1, ties: 0 });
  });

  it("ranks S. Rank over the whole field, our team included (1, 2, 3 by avg total)", () => {
    expect(row(200).sRank).toBe(1); // 80
    expect(board.ours?.sRank).toBe(2); // 65
    expect(row(100).sRank).toBe(3); // 50
  });

  it("gives teams with no scouted data '?' for rank and null for the S. columns", () => {
    expect(row(300)).toMatchObject({ sRank: null, sAvg: null, sHigh: null });
    expect(row(400)).toMatchObject({ sRank: null, sAvg: null, sHigh: null, oRank: null });
  });

  it("carries the scouted average and highest single-match total", () => {
    expect(row(200)).toMatchObject({ sAvg: 80, sHigh: 95 });
  });

  it("joins names, official rank, EPA", () => {
    expect(row(100)).toMatchObject({ teamName: "Alpha", oRank: 1, epa: 41.5 });
    expect(row(300).epa).toBeNull();
  });

  it("computes Pick % from our official rank: 0 for teams ranked above us, rising below, '-' when unranked", () => {
    expect(row(100).pickPct).toBe(0); // rank 1 vs our 3
    expect(row(200).pickPct!).toBeGreaterThan(0); // rank 5
    expect(row(300).pickPct!).toBeGreaterThan(row(200).pickPct!); // rank 9
    expect(row(400).pickPct).toBeNull(); // unranked
  });

  it("has no Pick % at all when our own rank is unknown (no rankings yet)", () => {
    const early = buildPickBoard({ ...input, rankings: [] });
    expect(early.rows.every((r) => r.pickPct === null && r.oRank === null)).toBe(true);
    expect(early.ours?.oRank).toBeNull();
  });

  it("turns EPA off with a null map", () => {
    expect(buildPickBoard({ ...input, epa: null }).rows.every((r) => r.epa === null)).toBe(true);
  });

  it("works when we aren't in the event's data at all", () => {
    const b = buildPickBoard({ ...input, ourTeamNumber: null });
    expect(b.ours).toBeNull();
    expect(b.rows).toHaveLength(5);
  });

  it("scales Pick % to the event size", () => {
    expect(board.teamCount).toBe(5);
  });
});

describe("sortPickRows / pickRowMatches", () => {
  const r = (teamNumber: number, over: Partial<PickRow> = {}): PickRow => ({
    teamNumber,
    teamName: null,
    oRank: null,
    record: null,
    rankingPoints: null,
    sRank: null,
    sAvg: null,
    sHigh: null,
    epa: null,
    pickPct: null,
    ...over,
  });
  const rows = [
    r(1, { oRank: 3, sRank: 2, sAvg: 40, sHigh: 90, epa: 10, pickPct: 0.1 }),
    r(2, { oRank: 1, sRank: 3, sAvg: 70, sHigh: 60, epa: 30, pickPct: 0.5 }),
    r(3, { oRank: 2, sRank: 1, sAvg: 55, sHigh: 75, epa: 20, pickPct: 0.9 }),
    r(4), // no data anywhere
  ];
  const order = (key: Parameters<typeof sortPickRows>[1]) => sortPickRows(rows, key).map((x) => x.teamNumber);

  it("sorts ranks ascending and scores/EPA/Pick % descending, no-data teams last", () => {
    expect(order("oRank")).toEqual([2, 3, 1, 4]);
    expect(order("sRank")).toEqual([3, 1, 2, 4]);
    expect(order("sAvg")).toEqual([2, 3, 1, 4]);
    expect(order("sHigh")).toEqual([1, 3, 2, 4]);
    expect(order("epa")).toEqual([2, 3, 1, 4]);
    expect(order("pickPct")).toEqual([3, 2, 1, 4]);
  });

  it("breaks ties and orders the unranked by team number, without mutating", () => {
    const tied = [r(9, { oRank: 1 }), r(2, { oRank: 1 }), r(8), r(5)];
    expect(sortPickRows(tied, "oRank").map((x) => x.teamNumber)).toEqual([2, 9, 5, 8]);
    expect(tied.map((x) => x.teamNumber)).toEqual([9, 2, 8, 5]);
  });

  it("searches by number or name", () => {
    expect(pickRowMatches({ teamNumber: 3468, teamName: "MAGNAtech" }, "346")).toBe(true);
    expect(pickRowMatches({ teamNumber: 3468, teamName: "MAGNAtech" }, "magna")).toBe(true);
    expect(pickRowMatches({ teamNumber: 3468, teamName: null }, "magna")).toBe(false);
    expect(pickRowMatches({ teamNumber: 1, teamName: null }, "")).toBe(true);
  });
});
