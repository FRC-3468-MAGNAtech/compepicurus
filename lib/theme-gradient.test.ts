import { describe, expect, it } from "vitest";
import { hexToOklab } from "./oklab";
import { luminance } from "./theme-color";
import {
  BAND_SOLID,
  DARK_TONE,
  DEFAULT_GRADIENT_INTENSITY,
  GRADIENT_INTENSITIES,
  INTENSITY_STRENGTH,
  LIGHT_TONE,
  paintGradient,
  stopList,
  toneColor,
} from "./theme-gradient";

// P32: the three page-paint styles and the tone bands.

const FLAG7 = ["#335add", "#358df7", "#83e2ff", "#ffffff", "#cd91f3", "#9d54e3", "#563399"];
const nondecreasing = (xs: number[]) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);

describe("smooth", () => {
  it("is the OKLCH samples evenly spread from 0 to 100", () => {
    const p = paintGradient(["#ffd800", "#7902aa"], "smooth");
    expect(p.shape).toBe("linear");
    expect(p.colors).toHaveLength(11);
    expect(p.positions).toHaveLength(p.colors.length);
    expect(p.positions[0]).toBe(0);
    expect(p.positions[p.positions.length - 1]).toBe(100);
    expect(nondecreasing(p.positions)).toBe(true);
    expect(p.colors[0]).toBe("#ffd800");
    expect(p.colors[10]).toBe("#7902aa");
  });

  it("a single color paints flat", () => {
    expect(paintGradient(["#336699"]).colors).toEqual(["#336699", "#336699"]);
  });
});

describe("banded", () => {
  const p = paintGradient(FLAG7, "banded");

  it("starts at 0, ends at 100, positions never go backwards, one list entry per color", () => {
    expect(p.shape).toBe("linear");
    expect(p.positions).toHaveLength(p.colors.length);
    expect(p.positions[0]).toBe(0);
    expect(p.positions[p.positions.length - 1]).toBe(100);
    expect(nondecreasing(p.positions)).toBe(true);
  });

  it("each interior stripe is about 70 percent solid, the rest blending into its neighbors", () => {
    expect(BAND_SOLID).toBe(0.7);
    const w = 100 / FLAG7.length;
    for (let i = 1; i < FLAG7.length - 1; i++) {
      const at = p.colors.map((c, k) => (c === FLAG7[i] ? p.positions[k] : null)).filter((x): x is number => x !== null);
      const solid = Math.max(...at) - Math.min(...at);
      expect(solid / w).toBeGreaterThan(0.68);
      expect(solid / w).toBeLessThan(0.72);
    }
  });

  it("the blends between stripes are in-between colors, not copies of either neighbor", () => {
    const a = FLAG7[0];
    const b = FLAG7[1];
    const lastA = p.colors.lastIndexOf(a);
    const firstB = p.colors.indexOf(b);
    expect(firstB - lastA).toBeGreaterThan(2); // several blend samples between them
    for (let k = lastA + 1; k < firstB; k++) expect([a, b]).not.toContain(p.colors[k]);
  });

  it("falls back to smooth for one color", () => {
    expect(paintGradient(["#336699"], "banded").colors.length).toBeGreaterThan(0);
  });
});

describe("radial", () => {
  const p = paintGradient(["#ffd800", "#7902aa"], "radial");
  it("is a field with a ring: field, blend in, ring, blend out, field", () => {
    expect(p.shape).toBe("radial");
    expect(p.colors[0]).toBe("#ffd800");
    expect(p.colors[p.colors.length - 1]).toBe("#ffd800");
    expect(p.colors).toContain("#7902aa");
    expect(p.positions[0]).toBe(0);
    expect(p.positions[p.positions.length - 1]).toBe(100);
    expect(nondecreasing(p.positions)).toBe(true);
    const ring = p.colors.map((c, i) => (c === "#7902aa" ? p.positions[i] : -1)).filter((x) => x >= 0);
    expect(Math.min(...ring)).toBeGreaterThan(20);
    expect(Math.max(...ring)).toBeLessThan(60);
  });
});

describe("stopList", () => {
  it("writes colors with positions", () => {
    expect(stopList({ colors: ["#000000", "#ffffff"], positions: [0, 100], shape: "linear" })).toBe("#000000 0%,#ffffff 100%");
  });
});

describe("tone", () => {
  const SAMPLES = ["#000000", "#ffffff", "#ffd800", "#ffed00", "#83e2ff", "#335add", "#7902aa", "#ff218c", "#21b1ff"];

  it("dark tone keeps every color inside the lightness band and under the luminance cap", () => {
    for (const hex of SAMPLES) {
      const out = toneColor(hex, DARK_TONE);
      expect(luminance(out), `${hex} -> ${out}`).toBeLessThanOrEqual(DARK_TONE.maxLuminance! + 0.005);
      expect(hexToOklab(out)[0], `${hex} -> ${out}`).toBeGreaterThan(0.25);
      expect(hexToOklab(out)[0]).toBeLessThan(DARK_TONE.hi + 0.01);
    }
  });

  it("light tone keeps every color light enough for dark text straight on the page", () => {
    for (const hex of SAMPLES) {
      const out = toneColor(hex, LIGHT_TONE);
      expect(luminance(out), `${hex} -> ${out}`).toBeGreaterThanOrEqual(LIGHT_TONE.minLuminance! - 0.005);
      expect(hexToOklab(out)[0], hex).toBeGreaterThan(0.7);
    }
  });

  it("keeps the hue: a blue stays blue, a yellow stays yellow", () => {
    const [, ba, bb] = hexToOklab(toneColor("#335add", DARK_TONE));
    expect(bb).toBeLessThan(0); // b < 0 is the blue side
    expect(Math.abs(bb)).toBeGreaterThan(Math.abs(ba) * 0.5);
    const [, , yb] = hexToOklab(toneColor("#ffd800", DARK_TONE));
    expect(yb).toBeGreaterThan(0.04); // b > 0 is the yellow side
  });
});

describe("gradient intensity", () => {
  it("is Subtle / Normal / Vivid, Vivid by default, and a stronger setting never paints less", () => {
    expect(GRADIENT_INTENSITIES).toEqual(["subtle", "normal", "vivid"]);
    expect(DEFAULT_GRADIENT_INTENSITY).toBe("vivid");
    expect(INTENSITY_STRENGTH.vivid).toBe(1);
    expect(INTENSITY_STRENGTH.subtle).toBeLessThan(INTENSITY_STRENGTH.normal);
    expect(INTENSITY_STRENGTH.normal).toBeLessThan(INTENSITY_STRENGTH.vivid);
    expect(INTENSITY_STRENGTH.subtle).toBeGreaterThan(0);
  });
});
