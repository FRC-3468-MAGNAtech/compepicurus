import { describe, expect, it } from "vitest";
import { compositeOver, contrastRatio, fitLuminance, luminance, luminanceWindow, mix, parseHex, parseRgba, rgbTriple, sampleGradient, toHex } from "./theme-color";

function grayWithLuminance(l: number): string {
  const s = l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055;
  const v = Math.round(s * 255);
  return toHex([v, v, v]);
}

describe("theme color math (P18)", () => {
  it("matches the WCAG reference ratios", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // #767676 on white is 4.54:1, the classic AA gray.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(contrastRatio("#000000", "#ffffff"), 10);
  });

  it("parses and formats hex", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
    expect(parseHex("E11D3C")).toEqual([225, 29, 60]);
    expect(toHex([225, 29, 60])).toBe("#e11d3c");
    expect(rgbTriple("#e11d3c")).toBe("225, 29, 60");
    expect(() => parseHex("nope")).toThrow();
  });

  it("mixes, composites and parses rgba()", () => {
    expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
    expect(compositeOver([255, 255, 255], 0.5, [0, 0, 0])).toEqual([127.5, 127.5, 127.5]);
    expect(parseRgba("rgba(255, 226, 150, 0.06)")).toEqual({ rgb: [255, 226, 150], alpha: 0.06 });
  });

  it("fitLuminance leaves a color alone when it already fits, and otherwise lands inside the window", () => {
    expect(fitLuminance("#2563eb", 0, 1)).toBe("#2563eb");
    const darker = fitLuminance("#ffd23f", 0, 0.15);
    expect(luminance(darker)).toBeLessThanOrEqual(0.15);
    const lighter = fitLuminance("#4a0d6e", 0.3, 1);
    expect(luminance(lighter)).toBeGreaterThanOrEqual(0.3);
  });

  it("fitLuminance keeps the hue family (red stays red)", () => {
    const [r, g, b] = parseHex(fitLuminance("#ff7a45", 0, 0.12));
    expect(r).toBeGreaterThan(g);
    expect(g).toBeGreaterThan(b);
  });

  it("luminanceWindow gives exactly the range that reaches the ratio", () => {
    const w = luminanceWindow(luminance("#ffffff"), 4.5, "darker");
    expect(contrastRatio("#ffffff", grayWithLuminance(w.hi))).toBeGreaterThanOrEqual(4.45);
    const lighter = luminanceWindow(luminance("#000000"), 4.5, "lighter");
    expect(lighter.lo).toBeCloseTo(0.175, 3);
  });

  it("samples a gradient evenly, ends included", () => {
    expect(sampleGradient(["#000000", "#ffffff"], 3)).toEqual(["#000000", "#808080", "#ffffff"]);
    expect(sampleGradient(["#ff0000"], 4)).toEqual(Array(4).fill("#ff0000"));
  });
});
