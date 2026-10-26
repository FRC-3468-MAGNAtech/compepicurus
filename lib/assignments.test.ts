import { describe, expect, it } from "vitest";
import { evaluateSlotSwap, type AssignmentVersion } from "./assignments";

function baseVersion(overrides: Partial<AssignmentVersion> = {}): AssignmentVersion {
  return {
    generatedBy: "admin-1",
    generatedAt: "2026-01-01T00:00:00.000Z",
    settings: {
      matchSource: "event",
      seasonId: null,
      difficulty: null,
      rangesText: "",
      categories: ["Qualification"],
      pattern: "rotate-each-match",
      intervalSize: null,
      scoutUids: ["a", "b"],
      prioritizedTeams: [],
      seed: 1,
    },
    slots: [
      { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
      { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: "b" },
    ],
    counts: { a: 1, b: 1 },
    fair: true,
    warning: null,
    ...overrides,
  };
}

describe("evaluateSlotSwap", () => {
  it("has no warnings for a clean swap", () => {
    const { warnings } = evaluateSlotSwap(baseVersion(), "Qualification", 1, "red1", "a");
    expect(warnings).toHaveLength(0);
  });

  it("warns about double-booking the same scout in one match", () => {
    const { warnings } = evaluateSlotSwap(baseVersion(), "Qualification", 1, "red1", "b");
    expect(warnings.some((w) => w.includes("already assigned"))).toBe(true);
  });

  it("warns when the swap would unbalance counts by more than 1", () => {
    const version = baseVersion({
      slots: [
        { matchType: "Qualification", matchNumber: 1, slot: "red1", teamNumber: 100, scoutUid: "a" },
        { matchType: "Qualification", matchNumber: 1, slot: "red2", teamNumber: 200, scoutUid: "b" },
        { matchType: "Qualification", matchNumber: 2, slot: "red1", teamNumber: 100, scoutUid: "a" },
      ],
      counts: { a: 2, b: 1 },
    });
    const { warnings } = evaluateSlotSwap(version, "Qualification", 1, "red2", "a");
    expect(warnings.some((w) => w.includes("uneven"))).toBe(true);
  });

  it("has no warnings when clearing a slot", () => {
    const { warnings } = evaluateSlotSwap(baseVersion(), "Qualification", 1, "red1", null);
    expect(warnings).toHaveLength(0);
  });
});
