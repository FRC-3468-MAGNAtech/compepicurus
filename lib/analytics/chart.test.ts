import { describe, expect, it } from "vitest";
import { niceTicks } from "./chart";

describe("niceTicks", () => {
  it("rounds the ceiling up to a round number and starts at 0", () => {
    expect(niceTicks(36)).toEqual([0, 10, 20, 30, 40]);
    expect(niceTicks(100)).toEqual([0, 50, 100]);
    expect(niceTicks(7)).toEqual([0, 2, 4, 6, 8]);
  });

  it("always covers the max", () => {
    for (const max of [1, 3, 13, 99, 101, 250, 1234]) {
      const ticks = niceTicks(max);
      expect(ticks[0]).toBe(0);
      expect(ticks[ticks.length - 1]).toBeGreaterThanOrEqual(max);
      expect(ticks.length).toBeLessThanOrEqual(7);
    }
  });

  it("has a sane axis for an empty or all-zero series", () => {
    expect(niceTicks(0)).toEqual([0, 1]);
    expect(niceTicks(Number.NaN)).toEqual([0, 1]);
  });
});
