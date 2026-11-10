import { describe, expect, it } from "vitest";
import { hexToOklab, oklabDistance, oklabLightness } from "./oklab";
import { themeCss, themeInitScript, tokensToCss } from "./theme-css";
import { DEFAULT_GRADIENT_INTENSITY, INTENSITY_STRENGTH } from "./theme-gradient";
import { GRADIENT_INTENSITY_STORAGE_KEY, gradientStrength, parseGradientIntensity, resolveGradientIntensity } from "./theme-prefs";
import { getTheme, hasModes, pageBackground, themeGroups, tokensFor } from "./themes";

// P32 tuning targets. Gradient and pride themes must read as colorful and bright, not near-black, and the shift must be easy to see.
// If screenshots show better numbers, change them here deliberately (docs/ASSUMPTIONS.md, P32-1): the point is that they are enforced.

const gradients = themeGroups.find((g) => g.kind === "gradient")!.themes;
const flags = themeGroups.find((g) => g.kind === "flag")!.themes;
const avgL = (stops: string[]) => stops.reduce((s, c) => s + oklabLightness(c), 0) / stops.length;

describe("gradient themes are vivid", () => {
  it.each(gradients.map((t) => [t.id, t] as const))("%s: first and last stop are at least 0.20 apart in OKLab", (_id, t) => {
    const first = t.gradientStops[0];
    const last = t.gradientStops[t.gradientStops.length - 1];
    expect(oklabDistance(first, last)).toBeGreaterThanOrEqual(0.2);
  });

  it.each(gradients.map((t) => [t.id, t] as const))("%s: the painted page is bright enough in dark mode and airy in light mode", (_id, t) => {
    if (!hasModes(t)) throw new Error("gradient themes have both modes");
    const dark = avgL(tokensFor(t, "dark").pageStops);
    const light = avgL(tokensFor(t, "light").pageStops);
    expect(dark, "dark page lightness").toBeGreaterThanOrEqual(0.3);
    expect(dark, "dark page lightness").toBeLessThanOrEqual(0.55);
    expect(light, "light page lightness").toBeGreaterThanOrEqual(0.8);
    expect(light, "light page lightness").toBeLessThanOrEqual(0.95);
  });

  it.each(gradients.map((t) => [t.id, t] as const))("%s: the painted page itself shifts visibly from one end to the other", (_id, t) => {
    for (const mode of ["dark", "light"] as const) {
      const stops = tokensFor(t, mode).pageStops;
      expect(oklabDistance(stops[0], stops[stops.length - 1]), mode).toBeGreaterThanOrEqual(mode === "dark" ? 0.12 : 0.08);
    }
  });

  it("the page is a dense sampled gradient (about 10 stops per transition), not two stops left to the browser", () => {
    for (const t of gradients) expect(tokensFor(t, "dark").pageStops.length).toBeGreaterThanOrEqual(10);
  });
});

describe("pride themes are bright too", () => {
  it.each(flags.map((t) => [t.id, t] as const))("%s: the painted page sits in the dark lightness band, not near-black", (_id, t) => {
    const l = avgL(tokensFor(t, "dark").pageStops);
    expect(l).toBeGreaterThanOrEqual(0.3);
    expect(l).toBeLessThanOrEqual(0.55);
  });

  it("flags with colors far apart in hue do not go muddy in the middle", () => {
    // Pan (pink / yellow / blue) and Intersex (yellow / purple): the lowest chroma along the painted page stays well clear of gray.
    for (const id of ["pride-pansexual", "pride-intersex", "pride-polysexual", "pride-bisexual"]) {
      const stops = tokensFor(getTheme(id), "dark").pageStops;
      const chroma = stops.map((c) => {
        const [, a, b] = hexToOklab(c);
        return Math.hypot(a, b);
      });
      // 0.05 is where a color starts to read as gray at these lightnesses
      expect(Math.min(...chroma), id).toBeGreaterThan(0.05);
    }
  });

  it("Pan is banded, Intersex is a radial ring, and the white-striped flags are banded too", () => {
    expect(tokensFor(getTheme("pride-pansexual"), "dark").pageShape).toBe("linear");
    expect(tokensFor(getTheme("pride-intersex"), "dark").pageShape).toBe("radial");
    const css = themeCss();
    expect(css).toMatch(/html\[data-theme="pride-intersex"\]\{[^}]*--page-bg:radial-gradient\(ellipse at 50% 50%,/);
    expect(css).toMatch(/html\[data-theme="pride-pansexual"\]\{[^}]*--page-bg:linear-gradient\(135deg,/);
    // banded means positions are not evenly spaced: there is a pair of equal-colored stops with a gap between them
    const pan = tokensFor(getTheme("pride-pansexual"), "dark");
    const dup = pan.pageStops.some((c, i) => i > 0 && c === pan.pageStops[i - 1] && pan.pagePositions[i] - pan.pagePositions[i - 1] > 5);
    expect(dup).toBe(true);
  });
});

describe("the page background in CSS", () => {
  it("a gradient theme writes its sampled stops with positions; a solid theme stays a flat color", () => {
    const nebula = tokensFor(getTheme("nebula"), "dark");
    const bg = pageBackground(nebula);
    expect(bg).toMatch(/^linear-gradient\(135deg,/);
    expect(bg.match(/#[0-9a-f]{6} [\d.]+%/g)!.length).toBe(nebula.pageStops.length);
    expect(pageBackground(tokensFor(getTheme("ocean"), "dark"))).toMatch(/^#[0-9a-f]{6}$/);
    expect(tokensToCss(nebula)).toContain(`--page-bg:${bg}`);
  });

  it("uses plain hex stops: no `in oklch` or oklch() that older browsers would drop", () => {
    expect(themeCss()).not.toMatch(/in oklch|oklch\(|oklab\(/);
  });

  it("Team Colors and BIOBUZZ still paint their plain, original backgrounds", () => {
    expect(pageBackground(tokensFor(getTheme("team"), "dark"))).toBe("#17070c");
    expect(pageBackground(tokensFor(getTheme("biobuzz"), "dark"))).toBe("#16110a");
  });
});

describe("Gradient intensity preference", () => {
  it("defaults to Vivid, accepts the three values, and rejects anything else", () => {
    expect(DEFAULT_GRADIENT_INTENSITY).toBe("vivid");
    expect(parseGradientIntensity("subtle")).toBe("subtle");
    expect(parseGradientIntensity("normal")).toBe("normal");
    expect(parseGradientIntensity("vivid")).toBe("vivid");
    for (const bad of ["Vivid", "", "max", null, undefined, 1, {}]) expect(parseGradientIntensity(bad)).toBeNull();
  });

  it("the account's choice wins, then this browser's, then Vivid", () => {
    expect(resolveGradientIntensity("subtle", "normal")).toBe("subtle");
    expect(resolveGradientIntensity(undefined, "normal")).toBe("normal");
    expect(resolveGradientIntensity("bogus", "bogus")).toBe("vivid");
    expect(resolveGradientIntensity(null, null)).toBe("vivid");
  });

  it("maps to the opacity of the painted layer", () => {
    expect(gradientStrength("vivid")).toBe(1);
    expect(gradientStrength("normal")).toBe(INTENSITY_STRENGTH.normal);
    expect(gradientStrength("subtle")).toBe(INTENSITY_STRENGTH.subtle);
  });

  it("the pre-paint script applies it from this browser's storage, ignoring unknown values", () => {
    const script = themeInitScript();
    expect(script).toContain(JSON.stringify(GRADIENT_INTENSITY_STORAGE_KEY));
    expect(script).toContain("--gradient-strength");
    const run = (stored: Record<string, string>) => {
      const props: Record<string, string> = {};
      const attrs: Record<string, string> = {};
      const documentElement = { setAttribute: (k: string, v: string) => (attrs[k] = v), style: { setProperty: (k: string, v: string) => (props[k] = v) } };
      const localStorage = { getItem: (k: string) => stored[k] ?? null };
      new Function("document", "localStorage", "matchMedia", "window", script)({ documentElement }, localStorage, () => ({ matches: false }), { matchMedia: () => ({ matches: false }) });
      return props;
    };
    expect(run({ [GRADIENT_INTENSITY_STORAGE_KEY]: "subtle" })["--gradient-strength"]).toBe(String(INTENSITY_STRENGTH.subtle));
    expect(run({ [GRADIENT_INTENSITY_STORAGE_KEY]: "normal" })["--gradient-strength"]).toBe(String(INTENSITY_STRENGTH.normal));
    expect(run({ [GRADIENT_INTENSITY_STORAGE_KEY]: "toString" })["--gradient-strength"]).toBeUndefined();
    expect(run({})["--gradient-strength"]).toBeUndefined();
    expect(run({ "compepicurus.glass-shade": "1.4" })["--glass-shade"]).toBe("1.4"); // the existing shade keeps working beside it
  });
});
