import { describe, expect, it } from "vitest";
import { computeScore, initialScoutEntryFields } from "@/lib/scout-entries";

describe("computeScore", () => {
  it("scores an empty match as zero", () => {
    expect(computeScore(initialScoutEntryFields)).toEqual({ auto: 0, teleop: 0, endgame: 0, total: 0 });
  });

  it("adds up auto points", () => {
    const score = computeScore({ ...initialScoutEntryFields, autoLeave: true, autoPark: true, autoTipHive: 2 });
    expect(score.auto).toBe(3 + 5 + 2 * 20);
  });

  it("adds up teleop points across hive, flower, and garden", () => {
    const score = computeScore({
      ...initialScoutEntryFields,
      teleTipHive: 1,
      flowerBottomNectar: true,
      flowerPollenNectar: 3,
      gardenPollenNectar: 4,
    });
    expect(score.teleop).toBe(20 + 5 + 3 * 2 + 4 * 1);
  });

  it("adds endgame park points", () => {
    expect(computeScore({ ...initialScoutEntryFields, endgamePark: true }).endgame).toBe(5);
  });

  it("totals every section", () => {
    const score = computeScore({
      ...initialScoutEntryFields,
      autoLeave: true,
      teleTipHive: 1,
      endgamePark: true,
    });
    expect(score.total).toBe(score.auto + score.teleop + score.endgame);
  });
});
