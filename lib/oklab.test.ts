import { describe, expect, it } from "vitest";
import {
  gamutMap,
  hexToOklab,
  hexToOklch,
  lchInGamut,
  lchToHex,
  lchToLinear,
  oklabDistance,
  oklabLightness,
  oklchStops,
  sampleOklch,
} from "./oklab";
import { mix, parseHex } from "./theme-color";

// P32: OKLab / OKLCH math and the sampled gradient stops.

const hueIn = (h: number, lo: number, hi: number) => (lo <= hi ? h >= lo && h <= hi : h >= lo || h <= hi);

describe("OKLab conversion", () => {
  it("matches the reference values", () => {
    const white = hexToOklab("#ffffff");
    expect(white[0]).toBeCloseTo(1, 3);
    expect(Math.abs(white[1])).toBeLessThan(1e-3);
    expect(hexToOklab("#000000")[0]).toBeCloseTo(0, 5);
    const [L, a, b] = hexToOklab("#ff0000");
    expect(L).toBeCloseTo(0.628, 2);
    expect(a).toBeCloseTo(0.225, 2);
    expect(b).toBeCloseTo(0.126, 2);
    expect(oklabLightness("#808080")).toBeGreaterThan(0.5);
    expect(oklabLightness("#808080")).toBeLessThan(0.65);
  });

  it("round-trips hex through OKLCH to within one 8-bit step", () => {
    for (const hex of ["#e40303", "#ffd800", "#21b1ff", "#7902aa", "#335add", "#83e2ff", "#95386f", "#ffffff", "#000000", "#808080"]) {
      const back = parseHex(lchToHex(hexToOklch(hex)));
      const orig = parseHex(hex);
      for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - orig[i])).toBeLessThanOrEqual(1);
    }
  });

  it("distance is zero for the same color, symmetric, and large for different hues", () => {
    expect(oklabDistance("#7902aa", "#7902aa")).toBe(0);
    expect(oklabDistance("#ffd800", "#7902aa")).toBeCloseTo(oklabDistance("#7902aa", "#ffd800"), 12);
    expect(oklabDistance("#ffd800", "#7902aa")).toBeGreaterThan(0.5);
    expect(oklabDistance("#336699", "#346699")).toBeLessThan(0.01);
  });
});

describe("gamut mapping", () => {
  it("brings an impossible color inside by lowering chroma only", () => {
    const wild: [number, number, number] = [0.7, 0.4, 150];
    expect(lchInGamut(wild)).toBe(false);
    const mapped = gamutMap(wild);
    expect(lchInGamut(mapped)).toBe(true);
    expect(mapped[0]).toBeCloseTo(0.7, 6);
    expect(mapped[2]).toBe(150);
    expect(mapped[1]).toBeLessThan(0.4);
    expect(mapped[1]).toBeGreaterThan(0.1); // still vivid
  });

  it("leaves a color that is already inside untouched", () => {
    const c = hexToOklch("#21b1ff");
    expect(gamutMap(c)).toEqual(c);
  });
});

describe("sampled OKLCH stops", () => {
  const PAN = ["#ff218c", "#ffd800", "#21b1ff"];
  const INTERSEX = ["#ffd800", "#7902aa"];

  it("gives the inputs plus `perTransition` stops between each pair (default 9: 10 steps)", () => {
    expect(oklchStops(INTERSEX)).toHaveLength(2 + 9);
    expect(oklchStops(PAN)).toHaveLength(3 + 2 * 9);
    expect(oklchStops(PAN, { perTransition: 8 })).toHaveLength(3 + 2 * 8);
    expect(oklchStops(PAN, { perTransition: 12 })).toHaveLength(3 + 2 * 12);
    expect(oklchStops(PAN, { perTransition: 0 })).toEqual(PAN);
  });

  it("the endpoints (and every input color) come back exactly as given", () => {
    const out = oklchStops(PAN, { perTransition: 9 });
    expect(out[0]).toBe("#ff218c");
    expect(out[10]).toBe("#ffd800");
    expect(out[out.length - 1]).toBe("#21b1ff");
    const flagged = sampleOklch(PAN);
    expect(flagged.filter((s) => s.input).map((s) => s.hex)).toEqual(PAN);
    // inputs are normalised to lower-case hex
    expect(oklchStops(["#FFD800", "#7902AA"], { perTransition: 1 })[0]).toBe("#ffd800");
  });

  it("no stop falls outside the sRGB gamut, before any clamping", () => {
    for (const stops of [PAN, INTERSEX, ["#335add", "#358df7", "#83e2ff", "#ffffff", "#cd91f3", "#9d54e3", "#563399"], ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"], ["#000000", "#ffffff", "#6e0071"]]) {
      for (const hue of ["shorter", "longer"] as const) {
        for (const s of sampleOklch(stops, { perTransition: 11, hue })) {
          expect(lchInGamut(s.lch, 1e-4), `${s.hex} (${s.lch.map((n) => n.toFixed(3)).join(", ")})`).toBe(true);
          // the linear channels are really inside 0..1, not merely close once rounded
          for (const v of lchToLinear(s.lch)) {
            expect(v).toBeGreaterThanOrEqual(-1e-4);
            expect(v).toBeLessThanOrEqual(1 + 1e-4);
          }
        }
      }
    }
  });

  it("yellow to purple goes through orange, red and magenta (the shorter arc), not through gray-brown", () => {
    const samples = sampleOklch(INTERSEX, { perTransition: 9 });
    const mid = samples.filter((s) => !s.input);
    // every intermediate hue is in the orange / red / magenta range
    for (const s of mid) expect(hueIn(s.lch[2], 300, 100), `hue ${s.lch[2].toFixed(0)}`).toBe(true);
    expect(mid.some((s) => hueIn(s.lch[2], 10, 40))).toBe(true); // red
    // it stays colorful: the plain sRGB middle is a dull brown, the OKLCH one is not
    const srgbMid = hexToOklch(mix("#ffd800", "#7902aa", 0.5));
    const lchMid = samples[Math.floor(samples.length / 2)].lch;
    expect(lchMid[1]).toBeGreaterThan(srgbMid[1] + 0.05);
    for (const s of mid) expect(s.lch[1]).toBeGreaterThan(0.13);
  });

  it("pink to yellow goes through orange, yellow to blue through green", () => {
    const s = sampleOklch(PAN, { perTransition: 9 });
    expect(hueIn(s[5].lch[2], 40, 80)).toBe(true); // between pink (about 355) and yellow (about 95): orange
    expect(hueIn(s[15].lch[2], 130, 190)).toBe(true); // between yellow and blue: green / teal
  });

  it("the longer arc takes the other way round", () => {
    const longer = sampleOklch(INTERSEX, { perTransition: 9, hue: "longer" }).filter((s) => !s.input);
    expect(longer.some((s) => hueIn(s.lch[2], 150, 250))).toBe(true); // green / cyan / blue
    expect(longer.some((s) => hueIn(s.lch[2], 10, 40))).toBe(false);
  });

  it("a white (or black) stop has no hue of its own: the colored neighbor's hue is kept while chroma fades", () => {
    const blue = hexToOklch("#335add");
    const toWhite = sampleOklch(["#335add", "#ffffff"], { perTransition: 9 }).filter((s) => !s.input);
    for (const s of toWhite) expect(Math.abs(s.lch[2] - blue[2])).toBeLessThan(2);
    for (let i = 1; i < toWhite.length; i++) {
      expect(toWhite[i].lch[1]).toBeLessThanOrEqual(toWhite[i - 1].lch[1] + 1e-9);
      expect(toWhite[i].lch[0]).toBeGreaterThanOrEqual(toWhite[i - 1].lch[0] - 1e-9);
    }
  });
});
