import { describe, expect, it } from "vitest";
import { isAllianceReadyToNotify } from "./notify";

describe("isAllianceReadyToNotify", () => {
  it("is eligible when two different scouts each covered one robot", () => {
    const entries = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "b", submittedAt: "2026-01-01T00:20:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(entries, 10)).toBe(true);
  });

  it("is eligible when one scout covered both within the window", () => {
    const entries = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "a", submittedAt: "2026-01-01T00:05:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(entries, 10)).toBe(true);
  });

  it("is not eligible when one scout's two entries are outside the window", () => {
    const entries = [
      { uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" },
      { uid: "a", submittedAt: "2026-01-01T00:15:00.000Z" },
    ];
    expect(isAllianceReadyToNotify(entries, 10)).toBe(false);
  });

  it("is not eligible when the alliance isn't fully covered", () => {
    expect(isAllianceReadyToNotify([{ uid: "a", submittedAt: "2026-01-01T00:00:00.000Z" }], 10)).toBe(false);
    expect(isAllianceReadyToNotify([], 10)).toBe(false);
  });
});
