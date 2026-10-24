import { describe, expect, it } from "vitest";
import { generateSessionId, getCategory } from "@/lib/practice-sessions";

describe("generateSessionId", () => {
  it("prefixes solo/live/lobby correctly", () => {
    expect(generateSessionId("solo")).toMatch(/^PS-/);
    expect(generateSessionId("live")).toMatch(/^LV-/);
    expect(generateSessionId("lobby")).toMatch(/^LB-/);
  });

  it("appends 6 characters from the unambiguous alphabet (no 0/O/1/I)", () => {
    for (let i = 0; i < 25; i++) {
      const id = generateSessionId("solo");
      const suffix = id.slice(3);
      expect(suffix).toHaveLength(6);
      expect(suffix).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it("is random across calls", () => {
    const ids = new Set(Array.from({ length: 50 }, () => generateSessionId("solo")));
    expect(ids.size).toBeGreaterThan(1);
  });
});

describe("getCategory", () => {
  it("maps event entries to real-event", () => {
    expect(getCategory({ source: "event", mode: null })).toBe("real-event");
  });

  it("maps live entries and live sessions to real-event, even with a mode set", () => {
    expect(getCategory({ source: "live", mode: "trial" })).toBe("real-event");
    expect(getCategory({ kind: "live", mode: "competitive" })).toBe("real-event");
  });

  it("maps practice entries to their mode", () => {
    expect(getCategory({ source: "practice", mode: "trial" })).toBe("trial");
    expect(getCategory({ source: "practice", mode: "competitive" })).toBe("competitive");
  });

  it("maps solo/lobby sessions to their mode", () => {
    expect(getCategory({ kind: "solo", mode: "competitive" })).toBe("competitive");
    expect(getCategory({ kind: "lobby", mode: "trial" })).toBe("trial");
  });

  it("falls back to trial when mode is null for a non-real-event input", () => {
    expect(getCategory({ source: "practice", mode: null })).toBe("trial");
  });
});
