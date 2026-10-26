import { describe, expect, it } from "vitest";
import type { MatchInput, RotationPattern } from "./types";
import { generateSchedule } from "./scheduler";

function makeMatches(count: number): MatchInput[] {
  return Array.from({ length: count }, (_, i) => ({
    matchType: "Qualification" as const,
    matchNumber: i + 1,
    red: [i * 4 + 1, i * 4 + 2] as [number, number],
    blue: [i * 4 + 3, i * 4 + 4] as [number, number],
  }));
}

function scoutIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `scout-${i + 1}`);
}

const PATTERNS: RotationPattern[] = ["rotate-each-match", "custom-interval", "constant-same-order"];

describe("generateSchedule — fairness", () => {
  // "Rotate Each Match" and "Constant Same Order" both re-pick (or re-window)
  // every single match, so they can and should hit exact +-1 fairness.
  // "Custom Interval" commits a whole batch of up to 4 scouts for every
  // match in an interval at once — the prompt's own text acknowledges this
  // ("works best in multiples of 4; otherwise build balanced batches as
  // best as possible") and provides the warn-when-impossible escape hatch,
  // so its achievable bound is the interval size, not 1 — see
  // docs/ASSUMPTIONS.md (P6).
  for (const pattern of ["rotate-each-match", "constant-same-order"] as RotationPattern[]) {
    for (let n = 1; n <= 14; n++) {
      it(`keeps assignment counts within 1 of each other for ${n} scout(s), pattern "${pattern}"`, () => {
        const result = generateSchedule(makeMatches(20), {
          scoutUids: scoutIds(n),
          pattern,
          seed: 42,
        });
        const counts = Object.values(result.counts);
        expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
        expect(result.fair).toBe(true);
      });
    }
  }

  const CUSTOM_INTERVAL_SIZE = 4;
  for (let n = 1; n <= 14; n++) {
    it(`keeps "custom-interval" assignment counts within one interval's worth of each other for ${n} scout(s)`, () => {
      const result = generateSchedule(makeMatches(40), {
        scoutUids: scoutIds(n),
        pattern: "custom-interval",
        intervalSize: CUSTOM_INTERVAL_SIZE,
        seed: 42,
      });
      const counts = Object.values(result.counts);
      const spread = Math.max(...counts) - Math.min(...counts);
      expect(spread).toBeLessThanOrEqual(CUSTOM_INTERVAL_SIZE);
      expect(result.fair).toBe(spread <= 1);
    });
  }

  it("'custom-interval' hits exact +-1 fairness for small pools that fit in a single batch (<=4 scouts)", () => {
    for (const n of [1, 2, 3, 4]) {
      const result = generateSchedule(makeMatches(20), {
        scoutUids: scoutIds(n),
        pattern: "custom-interval",
        intervalSize: 4,
        seed: 42,
      });
      const counts = Object.values(result.counts);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    }
  });
});

describe("generateSchedule — no double-booking", () => {
  for (const pattern of PATTERNS) {
    it(`never assigns the same scout twice within one match (pattern "${pattern}")`, () => {
      const result = generateSchedule(makeMatches(15), { scoutUids: scoutIds(6), pattern, seed: 7 });
      const byMatch = new Map<number, string[]>();
      for (const slot of result.slots) {
        if (!slot.scoutUid) continue;
        const list = byMatch.get(slot.matchNumber) ?? [];
        list.push(slot.scoutUid);
        byMatch.set(slot.matchNumber, list);
      }
      for (const uids of byMatch.values()) {
        expect(new Set(uids).size).toBe(uids.length);
      }
    });
  }
});

describe("generateSchedule — determinism", () => {
  it("produces identical output for the same seed, and can differ for a different seed", () => {
    const a = generateSchedule(makeMatches(10), { scoutUids: scoutIds(5), pattern: "rotate-each-match", seed: 1 });
    const b = generateSchedule(makeMatches(10), { scoutUids: scoutIds(5), pattern: "rotate-each-match", seed: 1 });
    expect(a.slots).toEqual(b.slots);

    const c = generateSchedule(makeMatches(10), { scoutUids: scoutIds(5), pattern: "rotate-each-match", seed: 2 });
    expect(c.slots).not.toEqual(a.slots);
  });
});

describe("generateSchedule — custom interval", () => {
  it("keeps the same batch of scouts assigned across every match in one interval", () => {
    const result = generateSchedule(makeMatches(8), {
      scoutUids: scoutIds(8),
      pattern: "custom-interval",
      intervalSize: 4,
      seed: 3,
    });
    const batchForMatch = (matchNumber: number) =>
      new Set(result.slots.filter((s) => s.matchNumber === matchNumber && s.scoutUid).map((s) => s.scoutUid));
    expect(batchForMatch(1)).toEqual(batchForMatch(2));
    expect(batchForMatch(1)).toEqual(batchForMatch(3));
    expect(batchForMatch(1)).toEqual(batchForMatch(4));
    // Matches 5-8 are a new interval — not guaranteed to differ, but should
    // still be internally consistent as one batch.
    expect(batchForMatch(5)).toEqual(batchForMatch(6));
  });
});

describe("generateSchedule — constant same order", () => {
  it("cycles through the same fixed batches, repeating after everyone has gone", () => {
    const result = generateSchedule(makeMatches(6), {
      scoutUids: scoutIds(6),
      pattern: "constant-same-order",
      seed: 9,
    });
    const batchForMatch = (matchNumber: number) =>
      new Set(result.slots.filter((s) => s.matchNumber === matchNumber && s.scoutUid).map((s) => s.scoutUid));
    // 6 scouts, a window of 4 sliding by 4 each match (mod 6) has period
    // 6/gcd(4,6) = 3 matches before it repeats.
    expect(batchForMatch(1)).toEqual(batchForMatch(4));
    expect(batchForMatch(2)).toEqual(batchForMatch(5));
    expect(batchForMatch(3)).toEqual(batchForMatch(6));
  });
});

describe("generateSchedule — prioritized teams", () => {
  it("only ever assigns prioritized teams' slots, leaving every other slot unassigned", () => {
    const matches = makeMatches(5);
    const prioritizedTeam = matches[0].red![0];
    const result = generateSchedule(matches, {
      scoutUids: scoutIds(5),
      pattern: "rotate-each-match",
      prioritizedTeams: [prioritizedTeam],
      seed: 5,
    });
    const assignedTeams = new Set(result.slots.filter((s) => s.scoutUid !== null).map((s) => s.teamNumber));
    expect(assignedTeams).toEqual(new Set([prioritizedTeam]));
  });

  it("still spreads assignments fairly across the scouts used for prioritized slots", () => {
    const matches = makeMatches(12);
    const prioritizedTeams = [matches[0].red![0], matches[0].blue![0]];
    const result = generateSchedule(matches, {
      scoutUids: scoutIds(4),
      pattern: "rotate-each-match",
      prioritizedTeams,
      seed: 11,
    });
    const counts = Object.values(result.counts);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });
});

describe("generateSchedule — edge cases", () => {
  it("leaves everything unassigned and warns when no scouts are selected", () => {
    const result = generateSchedule(makeMatches(3), { scoutUids: [], pattern: "rotate-each-match", seed: 1 });
    expect(result.slots.every((s) => s.scoutUid === null)).toBe(true);
    expect(result.warning).toBeTruthy();
  });

  it("gives a single scout exactly one slot per match — never two robots in the same match at once", () => {
    const result = generateSchedule(makeMatches(3), { scoutUids: ["only-one"], pattern: "rotate-each-match", seed: 1 });
    const filled = result.slots.filter((s) => s.scoutUid !== null);
    expect(filled).toHaveLength(3); // one per match, not four
    expect(filled.every((s) => s.scoutUid === "only-one")).toBe(true);
    expect(result.counts["only-one"]).toBe(3);
  });

  it("only generates slots for alliances present in the match (practice-library difficulty filtering)", () => {
    const result = generateSchedule(
      [{ matchType: "Qualification", matchNumber: 1, red: [1, 2], blue: null }],
      { scoutUids: scoutIds(4), pattern: "rotate-each-match", seed: 1 }
    );
    expect(result.slots).toHaveLength(2);
    expect(result.slots.every((s) => s.slot === "red1" || s.slot === "red2")).toBe(true);
  });
});
