import { describe, expect, it } from "vitest";
import { mulberry32 } from "@/lib/scheduler/rng";
import { assignPairs } from "./pairing";

const TEAMS = { red: [100, 200] as [number, number], blue: [300, 400] as [number, number] };

describe("assignPairs", () => {
  it("splits players into pairs of 2", () => {
    const pairs = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(1));
    expect(pairs).toHaveLength(2);
    expect(pairs.flatMap((p) => p.playerUids).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("alternates alliance across pairs", () => {
    const pairs = assignPairs(["a", "b", "c", "d", "e", "f"], TEAMS, mulberry32(42));
    expect(pairs.map((p) => p.alliance)).toEqual(["red", "blue", "red"]);
  });

  it("assigns each pair's two players to that alliance's two distinct team numbers", () => {
    const pairs = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(7));
    for (const pair of pairs) {
      const [teamA, teamB] = TEAMS[pair.alliance];
      const robots = pair.playerUids.map((uid) => pair.robotForUid[uid]);
      expect(robots.sort()).toEqual([teamA, teamB].sort());
    }
  });

  it("is deterministic for the same seed", () => {
    const a = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(99));
    const b = assignPairs(["a", "b", "c", "d"], TEAMS, mulberry32(99));
    expect(a).toEqual(b);
  });

  it("leaves an odd leftover player unpaired", () => {
    const pairs = assignPairs(["a", "b", "c"], TEAMS, mulberry32(1));
    expect(pairs).toHaveLength(1);
  });
});
