import { describe, expect, it } from "vitest";
import { CompressError, compressImage, fitWithin } from "@/lib/blob/compress";

describe("fitWithin", () => {
  it("never upscales", () => {
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(1600, 1600)).toEqual({ width: 1600, height: 1600 });
  });
  it("scales the long side to max and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000)).toEqual({ width: 1600, height: 1200 });
    expect(fitWithin(3000, 4000)).toEqual({ width: 1200, height: 1600 });
    expect(fitWithin(4000, 3000, 800)).toEqual({ width: 800, height: 600 });
  });
  it("rounds to whole pixels", () => {
    const r = fitWithin(4032, 3023);
    expect(Number.isInteger(r.width)).toBe(true);
    expect(Number.isInteger(r.height)).toBe(true);
    expect(r.width).toBe(1600);
    expect(r.height).toBe(Math.round((3023 * 1600) / 4032));
  });
  it("never rounds a side down to zero", () => {
    expect(fitWithin(100000, 10)).toEqual({ width: 1600, height: 1 });
  });
  it("returns 0x0 for zero, negative, NaN or infinite input", () => {
    const zero = { width: 0, height: 0 };
    expect(fitWithin(0, 100)).toEqual(zero);
    expect(fitWithin(100, 0)).toEqual(zero);
    expect(fitWithin(-5, 100)).toEqual(zero);
    expect(fitWithin(NaN, 100)).toEqual(zero);
    expect(fitWithin(100, Infinity)).toEqual(zero);
    expect(fitWithin(100, 100, 0)).toEqual(zero);
    expect(fitWithin(100, 100, NaN)).toEqual(zero);
  });
});

describe("compressImage", () => {
  it("refuses to run outside the browser, handing back the original", async () => {
    const file = new Blob(["x"], { type: "image/jpeg" });
    const err = await compressImage(file).catch((e) => e);
    expect(err).toBeInstanceOf(CompressError);
    expect(err.code).toBe("server");
    expect(err.original).toBe(file);
  });
});
