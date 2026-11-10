// Perceptual color math for the theme gradients (P32): sRGB <-> OKLab / OKLCH (Bjorn Ottosson's matrices), the OKLab
// distance, gamut mapping, and gradient stops sampled in OKLCH.
//
// Why: a plain sRGB blend between colors far apart in hue (yellow to purple, pink to yellow) passes through a muddy
// gray-brown. In OKLCH the hue travels around the wheel at constant lightness and chroma, so the middle stays vivid.
// The stops are SAMPLED here (8 to 12 per transition) and written into the CSS as plain hex stops, so every browser
// paints the same thing without needing `in oklch` gradient support. Pure: no DOM, no React.

import { parseHex, toHex, type RGB } from "./theme-color";

export type Lab = [number, number, number];
/** Lightness 0-1, chroma (about 0-0.37 inside sRGB), hue in degrees 0-360. */
export type Lch = [number, number, number];

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const fromLinear = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);

/** Linear sRGB (0-1 per channel, NOT clamped) to OKLab. */
export function linearToOklab([r, g, b]: [number, number, number]): Lab {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** OKLab to linear sRGB; the result can be outside 0-1 when the color is outside the sRGB gamut. */
export function oklabToLinear([L, a, b]: Lab): [number, number, number] {
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

export function rgbToOklab(rgb: RGB): Lab {
  return linearToOklab([toLinear(rgb[0] / 255), toLinear(rgb[1] / 255), toLinear(rgb[2] / 255)]);
}

export const hexToOklab = (hex: string): Lab => rgbToOklab(parseHex(hex));

export function labToLch([L, a, b]: Lab): Lch {
  const c = Math.hypot(a, b);
  const h = c < 1e-6 ? 0 : ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [L, c, h];
}

export function lchToLab([L, c, h]: Lch): Lab {
  const rad = (h * Math.PI) / 180;
  return [L, c * Math.cos(rad), c * Math.sin(rad)];
}

export const hexToOklch = (hex: string): Lch => labToLch(hexToOklab(hex));

/** OKLab lightness (0-1) of a hex color: the "L" the vibrancy targets are written in. */
export const oklabLightness = (hex: string): number => hexToOklab(hex)[0];

/** Euclidean distance in OKLab (the usual "delta E OK"). 0.02 is just noticeable; 0.2 is plainly different colors. */
export function oklabDistance(a: string, b: string): number {
  const x = hexToOklab(a);
  const y = hexToOklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

// ---------------------------------------------------------------------------
// Gamut

const GAMUT_EPS = 1e-4;

/** The unclamped linear sRGB of an OKLCH color. */
export const lchToLinear = (lch: Lch) => oklabToLinear(lchToLab(lch));

export function lchInGamut(lch: Lch, eps = GAMUT_EPS): boolean {
  return lchToLinear(lch).every((v) => v >= -eps && v <= 1 + eps);
}

/**
 * Brings a color into the sRGB gamut by lowering its chroma (lightness and hue kept), which keeps it as vivid as the
 * display allows instead of letting a channel clamp and shift the hue. A color already inside is returned untouched.
 */
export function gamutMap(lch: Lch): Lch {
  const L = Math.min(1, Math.max(0, lch[0]));
  const h = lch[2];
  if (L <= 0 || L >= 1) return [L, 0, h];
  if (lchInGamut([L, lch[1], h])) return [L, lch[1], h];
  let lo = 0;
  let hi = lch[1];
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (lchInGamut([L, mid, h], 0)) lo = mid;
    else hi = mid;
  }
  return [L, lo, h];
}

export function lchToHex(lch: Lch): string {
  const mapped = gamutMap(lch);
  const lin = lchToLinear(mapped);
  return toHex(lin.map((v) => fromLinear(Math.min(1, Math.max(0, v))) * 255) as RGB);
}

// ---------------------------------------------------------------------------
// Interpolation

/** Below this chroma a color's hue is meaningless (white, gray, black): it borrows its neighbor's. */
const ACHROMATIC = 0.02;

export type HuePath = "shorter" | "longer";

/** Signed hue travel from `a` to `b` in degrees along the chosen arc. */
function hueDelta(a: number, b: number, path: HuePath): number {
  let d = ((b - a + 540) % 360) - 180; // shorter arc, -180..180
  if (path === "longer") d = d >= 0 ? d - 360 : d + 360;
  return d;
}

/** One point along a transition, `t` 0 to 1, in OKLCH, gamut mapped. */
export function lerpLch(a: Lch, b: Lch, t: number, path: HuePath = "shorter"): Lch {
  const ha = a[1] < ACHROMATIC ? b[2] : a[2];
  const hb = b[1] < ACHROMATIC ? a[2] : b[2];
  const h = (ha + hueDelta(ha, hb, a[1] < ACHROMATIC || b[1] < ACHROMATIC ? "shorter" : path) * t + 360) % 360;
  return gamutMap([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, h]);
}

export type SampleOptions = {
  /** Intermediate stops per transition (not counting the two colors themselves). Default 9, so 10 steps. */
  perTransition?: number;
  /** Which way round the hue wheel. "shorter" (default) takes the nearer arc: pink to yellow goes through orange, yellow to purple through red and magenta. */
  hue?: HuePath;
};

/**
 * The colors themselves plus `perTransition` OKLCH-interpolated colors between each neighbor pair, as OKLCH tuples
 * (gamut mapped, not yet rounded to 8 bits). The first element is exactly the first input and so on: the input colors
 * are never recomputed, so they come back unchanged.
 */
export function sampleOklch(stops: string[], opts: SampleOptions = {}): { lch: Lch; hex: string; input: boolean }[] {
  const per = Math.max(0, Math.round(opts.perTransition ?? 9));
  const out: { lch: Lch; hex: string; input: boolean }[] = [];
  stops.forEach((hex, i) => {
    const lch = hexToOklch(hex);
    if (i > 0) {
      const prev = hexToOklch(stops[i - 1]);
      for (let k = 1; k <= per; k++) {
        const p = lerpLch(prev, lch, k / (per + 1), opts.hue);
        out.push({ lch: p, hex: lchToHex(p), input: false });
      }
    }
    out.push({ lch, hex: toHex(parseHex(hex)), input: true });
  });
  return out;
}

/** The sampled colors as hex: `stops.length` inputs and `perTransition` extra between each pair. */
export function oklchStops(stops: string[], opts: SampleOptions = {}): string[] {
  return sampleOklch(stops, opts).map((s) => s.hex);
}
