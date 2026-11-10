// How a theme's colors become the painted page background (P32). Pure.
//
// Three styles, chosen per flag:
//   smooth  one continuous gradient through the colors, interpolated in OKLCH (sampled, see lib/oklab.ts)
//   banded  the flag's stripes: each about 70 percent solid, with a soft blended edge (about 30 percent) between neighbors
//   radial  for a flag that is not stripes (Intersex): a field with a ring of the second color
// Every style produces plain hex stops with explicit positions, so it renders the same in every browser.

import { gamutMap, hexToOklch, lchToHex, lerpLch, oklchStops, type HuePath } from "./oklab";
import { luminance, toHex, parseHex } from "./theme-color";

export type GradientStyle = "smooth" | "banded" | "radial";

export type PaintedGradient = {
  /** Hex colors, in order. */
  colors: string[];
  /** Where each color sits, 0 to 100 (percent along the gradient line, or of the radius for `radial`). Same length as `colors`. */
  positions: number[];
  shape: "linear" | "radial";
};

export type PaintOptions = {
  hue?: HuePath;
  /** Intermediate stops per transition. Default 9 (10 steps, inside the 8 to 12 the design asks for). */
  perTransition?: number;
};

/** Share of a banded stripe that is solid color; the rest is the blend into its neighbors (half on each side). */
export const BAND_SOLID = 0.7;
/** Blend samples inside one banded edge. */
const BAND_BLEND_SAMPLES = 5;

const norm = (hex: string) => toHex(parseHex(hex));
const even = (n: number) => Array.from({ length: n }, (_, i) => (n === 1 ? 0 : (i / (n - 1)) * 100));

const round2 = (n: number) => Math.round(n * 100) / 100;

function smooth(stops: string[], o: PaintOptions): PaintedGradient {
  if (stops.length === 1) return { colors: [norm(stops[0]), norm(stops[0])], positions: [0, 100], shape: "linear" };
  const colors = oklchStops(stops, o);
  return { colors, positions: even(colors.length).map(round2), shape: "linear" };
}

/** Samples a blend between two colors, `k` points strictly between them, in OKLCH. */
function blend(a: string, b: string, k: number, hue?: HuePath): string[] {
  const la = hexToOklch(a);
  const lb = hexToOklch(b);
  return Array.from({ length: k }, (_, i) => lchToHex(lerpLch(la, lb, (i + 1) / (k + 1), hue)));
}

function banded(stops: string[], o: PaintOptions): PaintedGradient {
  const n = stops.length;
  if (n < 2) return smooth(stops, o);
  const w = 100 / n;
  const edge = (w * (1 - BAND_SOLID)) / 2; // each side of a boundary
  const colors: string[] = [];
  const positions: number[] = [];
  const push = (c: string, p: number) => {
    colors.push(c);
    positions.push(round2(Math.min(100, Math.max(0, p))));
  };
  stops.forEach((hex, i) => {
    const c = norm(hex);
    const start = i * w;
    const end = (i + 1) * w;
    // solid run: from the end of the blend with the previous stripe to the start of the blend with the next
    push(c, i === 0 ? 0 : start + edge);
    push(c, i === n - 1 ? 100 : end - edge);
    if (i < n - 1) {
      const mid = blend(c, norm(stops[i + 1]), BAND_BLEND_SAMPLES, o.hue);
      mid.forEach((m, k) => push(m, end - edge + ((k + 1) / (mid.length + 1)) * 2 * edge));
    }
  });
  return { colors, positions, shape: "linear" };
}

/** A field (first color) with a ring of the second color: solid field, blend in, solid ring, blend out, solid field. */
function radial(stops: string[], o: PaintOptions): PaintedGradient {
  if (stops.length < 2) return smooth(stops, o);
  const field = norm(stops[0]);
  const ring = norm(stops[stops.length - 1]);
  const colors: string[] = [];
  const positions: number[] = [];
  const push = (c: string, p: number) => {
    colors.push(c);
    positions.push(p);
  };
  const steps = (from: string, to: string, p0: number, p1: number) => {
    const mid = blend(from, to, o.perTransition ?? 9, o.hue);
    mid.forEach((m, k) => push(m, round2(p0 + ((k + 1) / (mid.length + 1)) * (p1 - p0))));
  };
  push(field, 0);
  push(field, 18);
  steps(field, ring, 18, 34);
  push(ring, 34);
  push(ring, 46);
  steps(ring, field, 46, 62);
  push(field, 62);
  push(field, 100);
  return { colors, positions, shape: "radial" };
}

export function paintGradient(stops: string[], style: GradientStyle = "smooth", o: PaintOptions = {}): PaintedGradient {
  if (style === "banded") return banded(stops, o);
  if (style === "radial") return radial(stops, o);
  return smooth(stops, o);
}

/** The CSS `<color-stop-list>` for a painted gradient: "#aabbcc 0%, #ddeeff 12.5%, ...". */
export function stopList(p: PaintedGradient): string {
  return p.colors.map((c, i) => `${c} ${p.positions[i]}%`).join(",");
}

// ---------------------------------------------------------------------------
// Tone: how bright and colorful the painted page is.

/**
 * Where the page background sits. A theme's own colors are often too dark or too light to paint a whole page with, so
 * each painted color keeps its hue and its relative lightness but is moved into a band: `lo`..`hi` of OKLab lightness,
 * with chroma scaled by `chroma` (then gamut mapped).
 */
export type Tone = {
  lo: number;
  hi: number;
  chroma: number;
  /** WCAG relative luminance no painted color may exceed (dark tone): yellow and white are far brighter than blue at the same OKLab lightness. */
  maxLuminance?: number;
  /** WCAG relative luminance no painted color may fall under (light tone), so the dark text stays readable straight on the page. */
  minLuminance?: number;
};

/**
 * Dark mode (and every flag): clearly lighter than near-black, so the gradient shows. The luminance cap keeps near-white
 * text readable on the page itself (4.6:1 for the muted text) and keeps every accent fill on one side of the page (lighter),
 * so a fill can be 3:1 off the darkest and the lightest part of it at once.
 */
export const DARK_TONE: Tone = { lo: 0.3, hi: 0.56, chroma: 1.15, maxLuminance: 0.15 };
/**
 * Light mode: light enough for dark text straight on the page, but colorful, not washed out. Near-white pages can't carry much chroma
 * (the sRGB gamut narrows towards white), so the band sits a little lower than "airy pastel" and the text colors are darkened to match
 * (vividPanel in lib/theme-tokens.ts).
 */
export const LIGHT_TONE: Tone = { lo: 0.68, hi: 0.91, chroma: 1.5, minLuminance: 0.42 };

export function toneColor(hex: string, tone: Tone): string {
  const [L, C, h] = hexToOklch(hex);
  let l = tone.lo + (tone.hi - tone.lo) * L;
  let out = lchToHex(gamutMap([l, C * tone.chroma, h]));
  for (let i = 0; tone.maxLuminance !== undefined && luminance(out) > tone.maxLuminance && i < 80; i++) {
    l -= 0.005;
    out = lchToHex(gamutMap([l, C * tone.chroma, h]));
  }
  for (let i = 0; tone.minLuminance !== undefined && luminance(out) < tone.minLuminance && i < 80; i++) {
    l += 0.005;
    out = lchToHex(gamutMap([l, C * tone.chroma, h]));
  }
  return out;
}

/** Gradient intensity (Settings > Appearance): how much of the painted page shows over the plain background. */
export type GradientIntensity = "subtle" | "normal" | "vivid";
export const GRADIENT_INTENSITIES: GradientIntensity[] = ["subtle", "normal", "vivid"];
export const DEFAULT_GRADIENT_INTENSITY: GradientIntensity = "vivid";
/** The opacity of the painted layer over the plain background. Vivid is the full painted page. */
export const INTENSITY_STRENGTH: Record<GradientIntensity, number> = { subtle: 0.35, normal: 0.65, vivid: 1 };
