import { describe, expect, it } from "vitest";
import type { OfficialAlliance, OfficialMatch } from "@/lib/analytics/match-breakdown";
import { mulberry32, seededShuffle } from "@/lib/scheduler/rng";
import { DEFAULT_EPA_PASSES, computeEpa, epaMatchesFromOfficial, learningRate, rankEpa, type EpaMatch } from "./index";

/** Spearman rank correlation (average ranks for ties). */
function spearman(a: number[], b: number[]): number {
  const ranks = (xs: number[]) => {
    const order = xs.map((v, i) => ({ v, i })).sort((p, q) => p.v - q.v);
    const r = new Array<number>(xs.length);
    for (let i = 0; i < order.length; ) {
      let j = i;
      while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
      for (let k = i; k <= j; k++) r[order[k].i] = (i + j) / 2 + 1;
      i = j + 1;
    }
    return r;
  };
  const ra = ranks(a);
  const rb = ranks(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    num += (ra[i] - ma) * (rb[i] - mb);
    da += (ra[i] - ma) ** 2;
    db += (rb[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

/** Box-Muller from a seeded uniform source. */
function gaussian(rng: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rng())) * Math.cos(2 * Math.PI * rng());
}

/**
 * A simulated event: every team has a hidden strength; an alliance scores the
 * sum of its two teams' strengths plus noise. Matches are built from shuffled
 * rounds so every team plays about the same number of times.
 */
function simulate(teamCount: number, rounds: number, noise: number, seed: number) {
  const rng = mulberry32(seed);
  const teams = Array.from({ length: teamCount }, (_, i) => 1000 + i);
  const strength = new Map(teams.map((t) => [t, 10 + rng() * 50]));
  const matches: EpaMatch[] = [];
  for (let r = 0; r < rounds; r++) {
    const order = seededShuffle(teams, rng);
    for (let i = 0; i + 3 < order.length; i += 4) {
      const alliance = (teams: number[]) => ({
        teams,
        score: Math.max(0, teams.reduce((s, t) => s + strength.get(t)!, 0) + gaussian(rng) * noise),
      });
      matches.push({ red: alliance([order[i], order[i + 1]]), blue: alliance([order[i + 2], order[i + 3]]) });
    }
  }
  return { teams, strength, matches };
}

describe("learningRate", () => {
  it("is 1/(n+1), floored at 0.1", () => {
    expect(learningRate(0)).toBe(1);
    expect(learningRate(1)).toBe(0.5);
    expect(learningRate(3)).toBe(0.25);
    expect(learningRate(9)).toBeCloseTo(0.1);
    expect(learningRate(50)).toBe(0.1);
  });
});

describe("computeEpa", () => {
  it("returns nothing for no matches", () => {
    const r = computeEpa([]);
    expect(r.epa.size).toBe(0);
    expect(r.matchesPlayed.size).toBe(0);
  });

  it("starts every team at the average alliance score / 2 and fits a lone match exactly", () => {
    // One match: red 60, blue 20 -> average 40 -> initial 20 per team. Red predicted 40, error +20,
    // first-match learning rate 1 -> each red team +10 = 30; blue error -20 -> each blue team -10 = 10.
    // (A single forward pass; a second pass would just re-fit the same match.)
    const r = computeEpa([{ red: { teams: [1, 2], score: 60 }, blue: { teams: [3, 4], score: 20 } }], { passes: 1 });
    expect(r.epa.get(1)).toBeCloseTo(30);
    expect(r.epa.get(2)).toBeCloseTo(30);
    expect(r.epa.get(3)).toBeCloseTo(10);
    expect(r.epa.get(4)).toBeCloseTo(10);
    expect(r.matchesPlayed.get(1)).toBe(1);
  });

  it("predicts both alliances from pre-match ratings (red/blue order can't matter)", () => {
    const a = computeEpa([{ red: { teams: [1, 2], score: 60 }, blue: { teams: [3, 4], score: 20 } }]);
    const b = computeEpa([{ red: { teams: [3, 4], score: 20 }, blue: { teams: [1, 2], score: 60 } }]);
    for (const t of [1, 2, 3, 4]) expect(a.epa.get(t)).toBeCloseTo(b.epa.get(t)!);
  });

  it("counts matches per team and rates only teams that played", () => {
    const r = computeEpa([
      { red: { teams: [1, 2], score: 50 }, blue: { teams: [3, 4], score: 40 } },
      { red: { teams: [1, 3], score: 45 }, blue: { teams: [2, 5], score: 30 } },
    ]);
    expect(r.matchesPlayed.get(1)).toBe(2);
    expect(r.matchesPlayed.get(4)).toBe(1);
    expect(r.matchesPlayed.get(5)).toBe(1);
    expect(r.epa.has(99)).toBe(false);
  });

  it("handles teams with very few matches without NaN", () => {
    const { matches } = simulate(12, 1, 5, 1); // each team plays once
    const r = computeEpa(matches);
    expect(r.epa.size).toBe(12);
    expect([...r.epa.values()].every(Number.isFinite)).toBe(true);
    expect([...r.matchesPlayed.values()].every((n) => n === 1)).toBe(true);
  });

  it("is deterministic and does not mutate its input", () => {
    const { matches } = simulate(12, 6, 5, 2);
    const copy = JSON.parse(JSON.stringify(matches));
    const a = computeEpa(matches);
    const b = computeEpa(matches);
    expect([...a.epa]).toEqual([...b.epa]);
    expect(matches).toEqual(copy);
  });

  it("ratings of a made-up all-equal event stay equal", () => {
    const matches: EpaMatch[] = [
      { red: { teams: [1, 2], score: 40 }, blue: { teams: [3, 4], score: 40 } },
      { red: { teams: [1, 3], score: 40 }, blue: { teams: [2, 4], score: 40 } },
    ];
    const r = computeEpa(matches);
    for (const v of r.epa.values()) expect(v).toBeCloseTo(20);
  });
});

describe("computeEpa recovers hidden strengths (simulated events)", () => {
  // The prompt's bar: Spearman >= 0.85 with 10+ matches per team.
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`24 teams, 12 matches each, noise 8 (seed ${seed})`, () => {
      const { teams, strength, matches } = simulate(24, 12, 8, seed);
      const { epa, matchesPlayed } = computeEpa(matches);
      expect(Math.min(...matchesPlayed.values())).toBeGreaterThanOrEqual(10);
      const rho = spearman(
        teams.map((t) => epa.get(t)!),
        teams.map((t) => strength.get(t)!)
      );
      expect(rho).toBeGreaterThanOrEqual(0.85);
    });
  }

  it("also holds with noisier scores (noise 15) and a larger field", () => {
    const { teams, strength, matches } = simulate(40, 12, 15, 11);
    const { epa } = computeEpa(matches);
    expect(
      spearman(
        teams.map((t) => epa.get(t)!),
        teams.map((t) => strength.get(t)!)
      )
    ).toBeGreaterThanOrEqual(0.85);
  });

  it("ranks the strongest team near the top", () => {
    const { teams, strength, matches } = simulate(24, 12, 8, 7);
    const ranked = rankEpa(computeEpa(matches));
    const best = teams.reduce((a, b) => (strength.get(a)! > strength.get(b)! ? a : b));
    expect(ranked.findIndex((r) => r.team === best)).toBeLessThan(4);
  });

  it("a plain single forward pass also clears the bar (the second pass is a refinement, not a crutch)", () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { teams, strength, matches } = simulate(24, 12, 8, seed);
      const { epa } = computeEpa(matches, { passes: 1 });
      expect(
        spearman(
          teams.map((t) => epa.get(t)!),
          teams.map((t) => strength.get(t)!)
        )
      ).toBeGreaterThanOrEqual(0.85);
    }
  });

  it("the second pass is at least as good as one pass on average (why it is the default)", () => {
    expect(DEFAULT_EPA_PASSES).toBe(2);
    let one = 0;
    let two = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const { teams, strength, matches } = simulate(24, 8, 8, seed);
      const truth = teams.map((t) => strength.get(t)!);
      one += spearman(teams.map((t) => computeEpa(matches, { passes: 1 }).epa.get(t)!), truth);
      two += spearman(teams.map((t) => computeEpa(matches, { passes: 2 }).epa.get(t)!), truth);
    }
    expect(two).toBeGreaterThan(one);
  });
});

describe("epaMatchesFromOfficial", () => {
  const m = (over: Omit<Partial<OfficialMatch>, "red" | "blue"> & { red?: Partial<OfficialAlliance>; blue?: Partial<OfficialAlliance> } = {}): OfficialMatch => ({
    eventCode: "E",
    matchType: "Qualification",
    matchNumber: 1,
    played: true,
    ...over,
    red: { teams: [1, 2], score: 80, penaltyPoints: 10, ...over.red },
    blue: { teams: [3, 4], score: 60, penaltyPoints: 0, ...over.blue },
  });

  it("subtracts each alliance's awarded penalty points from its score", () => {
    const [match] = epaMatchesFromOfficial([m()]);
    expect(match.red.score).toBe(70);
    expect(match.blue.score).toBe(60);
  });

  it("uses the raw score when the API gave no penalty figure", () => {
    const [match] = epaMatchesFromOfficial([m({ red: { penaltyPoints: null } })]);
    expect(match.red.score).toBe(80);
  });

  it("never goes below zero", () => {
    expect(epaMatchesFromOfficial([m({ red: { score: 5, penaltyPoints: 20 } })])[0].red.score).toBe(0);
  });

  it("keeps only played qualification matches with teams and scores, in match-number order", () => {
    const result = epaMatchesFromOfficial([
      m({ matchNumber: 3 }),
      m({ matchNumber: 1, red: { teams: [9, 8] } }),
      m({ matchNumber: 2, matchType: "Playoff" }),
      m({ matchNumber: 4, matchType: "Practice" }),
      m({ matchNumber: 5, played: false }),
      m({ matchNumber: 6, red: { score: null } }),
      m({ matchNumber: 7, blue: { teams: [] } }),
    ]);
    expect(result).toHaveLength(2);
    expect(result[0].red.teams).toEqual([9, 8]); // match 1 before match 3
    expect(result[1].red.teams).toEqual([1, 2]);
  });
});
