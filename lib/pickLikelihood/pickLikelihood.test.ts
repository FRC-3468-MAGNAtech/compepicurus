import { describe, expect, it } from "vitest";
import { MAX_PICK_PROBABILITY, MIN_SCALE } from "./config";
import { describePickGap, formatPickLikelihood, pickLikelihood, pickLikelihoodColor, pickScale } from "./index";

describe("pickScale", () => {
  it("is max(4, teamCount / 5)", () => {
    expect(pickScale(10)).toBe(MIN_SCALE);
    expect(pickScale(20)).toBe(4);
    expect(pickScale(40)).toBe(8);
    expect(pickScale(100)).toBe(20);
  });
});

describe("pickLikelihood", () => {
  it("has no value when either rank is unknown", () => {
    expect(pickLikelihood(null, 5, 30)).toBeNull();
    expect(pickLikelihood(5, null, 30)).toBeNull();
    expect(pickLikelihood(null, null, 30)).toBeNull();
  });

  it("is 0 for a candidate ranked above or equal to us", () => {
    expect(pickLikelihood(1, 5, 30)).toBe(0);
    expect(pickLikelihood(4, 5, 30)).toBe(0);
    expect(pickLikelihood(5, 5, 30)).toBe(0);
  });

  it("follows maxP * (1 - exp(-(gap/scale)^2))", () => {
    const teamCount = 40; // scale 8
    const gap = 8;
    expect(pickLikelihood(10 + gap, 10, teamCount)).toBeCloseTo(0.95 * (1 - Math.exp(-1)));
    expect(pickLikelihood(10 + 16, 10, teamCount)).toBeCloseTo(0.95 * (1 - Math.exp(-4)));
  });

  it("is very low for the team ranked just below us", () => {
    const p = pickLikelihood(11, 10, 40)!; // gap 1, scale 8
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(0.02);
    // Even on a small event (scale floors at 4) it stays under 10%.
    expect(pickLikelihood(11, 10, 12)!).toBeLessThan(0.1);
  });

  it("rises with the gap and never reaches maxP", () => {
    let prev = 0;
    for (let rank = 11; rank <= 200; rank++) {
      const p = pickLikelihood(rank, 10, 40)!;
      expect(p).toBeGreaterThanOrEqual(prev);
      expect(p).toBeLessThanOrEqual(MAX_PICK_PROBABILITY);
      prev = p;
    }
    expect(pickLikelihood(200, 10, 40)!).toBeCloseTo(MAX_PICK_PROBABILITY, 3);
  });

  it("a larger event needs a bigger gap for the same odds", () => {
    expect(pickLikelihood(20, 10, 100)!).toBeLessThan(pickLikelihood(20, 10, 20)!);
  });
});

describe("formatPickLikelihood", () => {
  it("prints '-', 0%, <1%, and whole percents", () => {
    expect(formatPickLikelihood(null)).toBe("-");
    expect(formatPickLikelihood(0)).toBe("0%");
    expect(formatPickLikelihood(0.001)).toBe("<1%");
    expect(formatPickLikelihood(0.0049)).toBe("<1%");
    expect(formatPickLikelihood(0.005)).toBe("1%");
    expect(formatPickLikelihood(0.456)).toBe("46%");
    expect(formatPickLikelihood(0.95)).toBe("95%");
  });
});

describe("pickLikelihoodColor / describePickGap", () => {
  it("runs red (hue 0) to green (hue 120)", () => {
    expect(pickLikelihoodColor(null)).toBeUndefined();
    expect(pickLikelihoodColor(0)).toContain("hsl(0 ");
    expect(pickLikelihoodColor(MAX_PICK_PROBABILITY)).toContain("hsl(120 ");
    expect(pickLikelihoodColor(MAX_PICK_PROBABILITY / 2)).toContain("hsl(60 ");
  });

  it("describes the gap", () => {
    expect(describePickGap(null, 3)).toContain("Needs both");
    expect(describePickGap(2, 5)).toBe("Ranked 3 above us (rank 2 vs our 5).");
    expect(describePickGap(5, 5)).toBe("Tied with our rank (5).");
    expect(describePickGap(9, 5)).toBe("Ranked 4 below us (rank 9 vs our 5).");
  });
});
