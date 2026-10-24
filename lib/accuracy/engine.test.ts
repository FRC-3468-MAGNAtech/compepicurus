import { describe, expect, it } from "vitest";
import { computeAllianceAccuracy, getPercentColor, getStatus, rankWithTies } from "@/lib/accuracy/engine";

describe("computeAllianceAccuracy", () => {
  it("is 100 when the scouted total matches the official score exactly", () => {
    const result = computeAllianceAccuracy({ robotScores: [75, 75], penaltyPoints: 0, officialScore: 150 });
    expect(result).toEqual({ accuracy: 100, scoutedTotal: 150, officialScore: 150, penaltyPoints: 0, difference: 0 });
  });

  it("includes penalty points in the scouted total", () => {
    const result = computeAllianceAccuracy({ robotScores: [60, 60], penaltyPoints: 10, officialScore: 130 });
    expect(result.scoutedTotal).toBe(130);
    expect(result.accuracy).toBe(100);
  });

  it("degrades proportionally to the gap between scouted and official scores", () => {
    // scoutedTotal = 100, official = 150 -> |150-100|/150 = 1/3 off -> 200/3 %
    const result = computeAllianceAccuracy({ robotScores: [50, 50], penaltyPoints: 0, officialScore: 150 });
    expect(result.accuracy).toBeCloseTo((2 / 3) * 100, 5);
    expect(result.difference).toBe(-50);
  });

  it("reports a positive difference when the scouted total is higher than official", () => {
    const result = computeAllianceAccuracy({ robotScores: [100, 100], penaltyPoints: 0, officialScore: 150 });
    expect(result.difference).toBe(50);
  });

  it("never goes below 0", () => {
    const result = computeAllianceAccuracy({ robotScores: [0, 0], penaltyPoints: 0, officialScore: 10 });
    expect(result.accuracy).toBe(0);
  });

  it("treats a zero official score as perfect only when the scouted total is also zero", () => {
    expect(computeAllianceAccuracy({ robotScores: [0, 0], penaltyPoints: 0, officialScore: 0 }).accuracy).toBe(100);
    expect(computeAllianceAccuracy({ robotScores: [5, 0], penaltyPoints: 0, officialScore: 0 }).accuracy).toBe(0);
  });
});

describe("getStatus", () => {
  it("buckets accuracy into the four tiers, rounding first", () => {
    expect(getStatus(0).id).toBe("mentor-intervention");
    expect(getStatus(50.4).id).toBe("mentor-intervention");
    expect(getStatus(50.5).id).toBe("student-intervention");
    expect(getStatus(74).id).toBe("student-intervention");
    expect(getStatus(75).id).toBe("good");
    expect(getStatus(89).id).toBe("good");
    expect(getStatus(90).id).toBe("excellent");
    expect(getStatus(100).id).toBe("excellent");
  });
});

describe("getPercentColor", () => {
  it("buckets accuracy into the four color bands, rounding first", () => {
    expect(getPercentColor(74)).toBe("text-red-400");
    expect(getPercentColor(75)).toBe("text-orange-400");
    expect(getPercentColor(84)).toBe("text-orange-400");
    expect(getPercentColor(85)).toBe("text-yellow-400");
    expect(getPercentColor(94)).toBe("text-yellow-400");
    expect(getPercentColor(95)).toBe("text-green-400");
    expect(getPercentColor(100)).toBe("text-green-400");
  });
});

describe("rankWithTies", () => {
  it("ranks descending, with ties sharing a rank and the next rank skipping", () => {
    const items = [{ v: 90 }, { v: 80 }, { v: 80 }, { v: 70 }];
    const ranked = rankWithTies(items, (i) => i.v);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, 2, 4]);
  });

  it("gives items with no value a null rank and sorts them last", () => {
    const items = [{ v: 90 }, { v: null }, { v: 80 }];
    const ranked = rankWithTies(items, (i) => i.v);
    expect(ranked.map((r) => r.item.v)).toEqual([90, 80, null]);
    expect(ranked.map((r) => r.rank)).toEqual([1, 2, null]);
  });

  it("handles every item having no value", () => {
    const items = [{ v: null }, { v: null }];
    const ranked = rankWithTies(items, (i) => i.v);
    expect(ranked.every((r) => r.rank === null)).toBe(true);
  });
});
