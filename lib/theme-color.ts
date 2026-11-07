// Pure color math for the theme system (P18). No DOM, no React: the theme registry builds its
// tokens with it and the contrast guard (lib/theme-contrast.ts) measures them with it.

export type RGB = [number, number, number];

export function parseHex(hex: string): RGB {
  let h = hex.trim().replace(/^#/, "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`Not a hex color: ${hex}`);
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

const clamp255 = (n: number) => Math.min(255, Math.max(0, Math.round(n)));

export function toHex(rgb: RGB): string {
  return `#${rgb.map((c) => clamp255(c).toString(16).padStart(2, "0")).join("")}`;
}

/** "r, g, b", the form the app's `--glow` / `--surface-tint` variables use inside `rgba(var(--glow), a)`. */
export function rgbTriple(color: string | RGB): string {
  const rgb = typeof color === "string" ? parseHex(color) : color;
  return rgb.map(clamp255).join(", ");
}

const rgbOf = (c: string | RGB): RGB => (typeof c === "string" ? parseHex(c) : c);

/** Linear sRGB blend: `t` = 0 is `a`, 1 is `b`. */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** WCAG 2.x relative luminance. */
export function luminance(color: string | RGB): number {
  const [r, g, b] = rgbOf(color).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1-21, order-independent. */
export function contrastRatio(a: string | RGB, b: string | RGB): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** What a translucent layer looks like once painted over an opaque color. */
export function compositeOver(fg: string | RGB, alpha: number, bg: string | RGB): RGB {
  const f = rgbOf(fg);
  const b = rgbOf(bg);
  return [f[0] * alpha + b[0] * (1 - alpha), f[1] * alpha + b[1] * (1 - alpha), f[2] * alpha + b[2] * (1 - alpha)];
}

/** Parses the "rgba(r, g, b, a)" strings the tokens use for translucent layers. */
export function parseRgba(value: string): { rgb: RGB; alpha: number } {
  const m = value.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/);
  if (!m) throw new Error(`Not an rgba() color: ${value}`);
  return { rgb: [Number(m[1]), Number(m[2]), Number(m[3])], alpha: m[4] === undefined ? 1 : Number(m[4]) };
}

// ---------------------------------------------------------------------------
// HSL, used to nudge a color lighter or darker while keeping its hue and saturation.

function toHsl([r, g, b]: RGB): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}

function fromHsl(h: number, s: number, l: number): RGB {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

/**
 * Moves a color's HSL lightness (hue and saturation kept) until its relative
 * luminance lands inside [lo, hi]. A color already inside is returned untouched.
 * Returns the hex that is closest to the original that is still inside the window.
 */
export function fitLuminance(color: string, lo: number, hi: number): string {
  const current = luminance(color);
  if (current >= lo && current <= hi) return color;
  if (lo > hi) return color;
  const [h, s, l0] = toHsl(parseHex(color));
  const goLighter = current < lo;
  // Aim a hair inside the window so 8-bit rounding can't push the hex back out of it.
  const margin = Math.min(0.012, (hi - lo) / 4);
  const target = goLighter ? lo + margin : hi - margin;
  let a = goLighter ? l0 : 0;
  let b = goLighter ? 1 : l0;
  for (let i = 0; i < 40; i++) {
    const mid = (a + b) / 2;
    const lum = luminance(fromHsl(h, s, mid));
    if (lum < target) a = mid;
    else b = mid;
  }
  return toHex(fromHsl(h, s, goLighter ? b : a));
}

/** The range of luminances that reach `ratio` contrast against a color of luminance `other`. */
export function luminanceWindow(other: number, ratio: number, side: "lighter" | "darker"): { lo: number; hi: number } {
  if (side === "lighter") {
    // The candidate is lighter than `other`: (L + .05) / (other + .05) >= ratio.
    return { lo: ratio * (other + 0.05) - 0.05, hi: 1 };
  }
  return { lo: 0, hi: (other + 0.05) / ratio - 0.05 };
}

export const intersectWindows = (a: { lo: number; hi: number }, b: { lo: number; hi: number }) => ({ lo: Math.max(a.lo, b.lo), hi: Math.min(a.hi, b.hi) });

/** Evenly spaced samples along a sRGB gradient (what a browser paints between stops, equal spacing). */
export function sampleGradient(stops: string[], count: number): string[] {
  if (stops.length === 1) return Array(count).fill(stops[0]);
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const pos = (i / (count - 1)) * (stops.length - 1);
    const idx = Math.min(stops.length - 2, Math.floor(pos));
    out.push(mix(stops[idx], stops[idx + 1], pos - idx));
  }
  return out;
}
