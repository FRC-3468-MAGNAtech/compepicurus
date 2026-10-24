import { describe, expect, it } from "vitest";
import { getDifficulty } from "@/lib/difficulty";

describe("getDifficulty", () => {
  it("is easy at and below 40", () => {
    expect(getDifficulty(0)).toBe("easy");
    expect(getDifficulty(40)).toBe("easy");
  });

  it("is medium from 41 to 79", () => {
    expect(getDifficulty(41)).toBe("medium");
    expect(getDifficulty(79)).toBe("medium");
  });

  it("is hard at 80 and above", () => {
    expect(getDifficulty(80)).toBe("hard");
    expect(getDifficulty(500)).toBe("hard");
  });
});
