// The theme model (P18): types, and the builders that turn a short description of a theme
// ("these two accent colors on this tint") into the full per-mode token set the CSS needs.
// Pure, so the contrast guard, the unit tests and the server (CSS generation) all share it.
//
// The one rule the builders enforce: every color that carries text (a button, the active
// nav pill, a gradient stop) is nudged, in HSL lightness only, until the text on it reaches
// 4.5:1, and until it stands 3:1 off the page. Hue and saturation are never touched, so a
// theme still looks like itself. lib/theme-contrast.ts then measures the result independently.

import {
  compositeOver,
  contrastRatio,
  fitLuminance,
  intersectWindows,
  luminance,
  luminanceWindow,
  mix,
  parseHex,
  parseRgba,
  rgbTriple,
  sampleGradient,
} from "./theme-color";

export type ColorMode = "light" | "dark";
/** What the user picks: a mode, or "system" to follow the device. */
export type ColorModePreference = ColorMode | "system";
export type ThemeKind = "solid" | "gradient" | "flag";

/** Everything the app's CSS reads, resolved to concrete values for one theme in one mode. */
export type ThemeTokens = {
  colorScheme: ColorMode;
  background: string;
  foreground: string;
  mutedForeground: string;
  /** Solid fills + text-on-accent: every one of these is already fitted for `primaryForeground`. */
  primary: string;
  primaryForeground: string;
  secondary: string;
  accent: string;
  /** Fitted stops for buttons, active tabs, progress bars. Evenly spaced. Text on any point of it passes 4.5:1. */
  gradient: string[];
  /** "r, g, b" for `rgba(var(--glow), a)` */
  glow: string;
  glowSoft: string;
  surfaceTint: string;
  blobs: [string, string, string];
  /** The page background: one hex (flat) or several (a diagonal gradient). */
  pageStops: string[];
  glassBg: string;
  glassBgStrong: string;
  glassBorder: string;
  glassShadow: string;
  /** Opaque base of floating overlays (dropdowns, popovers, modals) and its alpha at the default glass level. */
  overlayColor: string;
  overlayAlpha: number;
  overlayBorder: string;
  /** Fully opaque panel color: status chips and anything that must never sit behind glass transparency. */
  surfaceSolid: string;
  focusRing: string;
  /** "r, g, b" the translucent hover/fill tints are drawn with (white on dark, black on light). */
  tint: string;
  statusOnline: string;
  statusOffline: string;
  statusSyncing: string;
};

export type ThemeDefinition = {
  id: string;
  name: string;
  kind: ThemeKind;
  tagline: string;
  /** Representative colors for swatches and the preview card. */
  accents: string[];
  /** The raw, unfitted gradient colors (gradient and flag themes; solid themes: primary to accent). */
  gradientStops: string[];
  /** "r, g, b" of the main glow (raw, never fitted). */
  glowColor: string;
  /** "r, g, b" that tints the glass surface. */
  glassTint: string;
  /** Forced text-on-accent colors, when the default white / near-black pick isn't wanted. */
  textOnAccent?: { light?: string; dark?: string };
  /** Page background per mode (flag themes: one fixed value under `dark`). */
  backgroundGradient: { light?: string[]; dark: string[] };
  /** Solid and gradient themes have both modes. Flag themes have one fixed set and ignore the user's mode. */
  tokens: { light: ThemeTokens; dark: ThemeTokens } | { fixed: ThemeTokens };
};

export const hasModes = (t: ThemeDefinition): t is ThemeDefinition & { tokens: { light: ThemeTokens; dark: ThemeTokens } } => "light" in t.tokens;

export function tokensFor(theme: ThemeDefinition, mode: ColorMode): ThemeTokens {
  return "fixed" in theme.tokens ? theme.tokens.fixed : theme.tokens[mode];
}

// ---------------------------------------------------------------------------
// Surfaces the contrast guard (and the focus-ring fit) measure against.

const PAGE_SAMPLES = 5;
const BLOB_OPACITY = 0.6; // the strongest of BackgroundBlobs' three (see components/layout/background-blobs.tsx)

/** Every opaque color the page can show behind glass: its background, plus each blob at full strength. */
export function pageColors(t: ThemeTokens): string[] {
  const base = t.pageStops.length === 1 ? [t.pageStops[0]] : sampleGradient(t.pageStops, PAGE_SAMPLES);
  const blobs = t.blobs.flatMap((b) => base.map((p) => mix(p, b, BLOB_OPACITY)));
  return [...base, ...blobs, t.background];
}

/** What a translucent glass layer looks like (one layer, and a card on a panel) over every page color. */
export function glassColors(t: ThemeTokens, strong = false): string[] {
  const layer = parseRgba(strong ? t.glassBgStrong : t.glassBg);
  const toHex = (rgb: [number, number, number]) => `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  return pageColors(t).flatMap((p) => {
    const one = compositeOver(layer.rgb, layer.alpha, p);
    return [toHex(one), toHex(compositeOver(layer.rgb, layer.alpha, one))];
  });
}

/** A floating overlay over the page, and (text checks only) over the two extremes of content that could sit under it. */
export function overlayColors(t: ThemeTokens, extremes = true): string[] {
  const under = extremes ? [...pageColors(t), "#000000", "#ffffff"] : pageColors(t);
  return under.map((u) => {
    const rgb = compositeOver(t.overlayColor, t.overlayAlpha, u);
    return `#${rgb.map((c) => Math.round(c).toString(16).padStart(2, "0")).join("")}`;
  });
}

/** Every surface body text can land on, worst cases included. */
export function textSurfaces(t: ThemeTokens): string[] {
  return [...pageColors(t), ...glassColors(t), ...glassColors(t, true), ...overlayColors(t), t.surfaceSolid];
}

/** Every surface a UI element (focus ring, status dot) can land on in real use. */
export function uiSurfaces(t: ThemeTokens): string[] {
  return [...pageColors(t), ...glassColors(t), ...glassColors(t, true), ...overlayColors(t, false), t.surfaceSolid];
}

// ---------------------------------------------------------------------------
// Fitting

const TEXT_RATIO = 4.55; // the 4.5 AA bar plus a hair, so 8-bit rounding can't land under it
const UI_RATIO = 3.2; // the 3.0 non-text bar plus a hair
const WHITE = "#ffffff";
const INK = "#0b0b0d";

function lighterSide(bgHex: string): boolean {
  return luminance(bgHex) < 0.18;
}

/** Luminance window for a color that must stand `UI_RATIO` off the page. */
function pageWindow(bg: string) {
  const lb = luminance(bg);
  return lighterSide(bg) ? luminanceWindow(lb, UI_RATIO, "lighter") : luminanceWindow(lb, UI_RATIO, "darker");
}

/** Window for a fill that carries `text`. */
function textWindow(text: string) {
  const lt = luminance(text);
  // Text lighter than mid-grey sits on a darker fill; darker text on a lighter fill.
  return lt >= 0.18 ? luminanceWindow(lt, TEXT_RATIO, "darker") : luminanceWindow(lt, TEXT_RATIO, "lighter");
}

const REFINED_SAMPLES = 13;

type Fitted = { text: string; stops: string[]; cost: number };

/**
 * Chooses the text color (from `texts`) that needs the least change to the gradient, and returns
 * the stops nudged into legibility. Each stop is fitted on its own, at 3 samples per segment,
 * so the blended middle of the gradient passes as well as the ends.
 */
function fitGradient(rawStops: string[], bg: string, texts: string[]): Fitted {
  const count = rawStops.length === 1 ? 2 : (rawStops.length - 1) * 3 + 1;
  const samples = sampleGradient(rawStops.length === 1 ? [rawStops[0], rawStops[0]] : rawStops, count);
  let best: Fitted | null = null;
  for (const text of texts) {
    const win = intersectWindows(textWindow(text), pageWindow(bg));
    let cost = 0;
    const fit = (c: string) => (win.lo > win.hi ? c : fitLuminance(c, win.lo, win.hi));
    const first = samples.map((s) => {
      if (win.lo > win.hi) {
        cost += 100;
        return s;
      }
      const fitted = fit(s);
      cost += Math.abs(luminance(fitted) - luminance(s));
      return fitted;
    });
    // Blending two fitted stops in sRGB can dip just under the window between them (a saturated color next to a washed-out one),
    // so the blend itself is sampled densely and fitted again. The result is the gradient as the browser will actually paint it.
    const stops = sampleGradient(first, REFINED_SAMPLES).map(fit);
    if (!best || cost < best.cost) best = { text, stops, cost };
  }
  return best!;
}

/** A single color kept 3:1 off the page (secondary / text-gradient end). */
function fitToPage(color: string, bg: string): string {
  const w = pageWindow(bg);
  return fitLuminance(color, w.lo, w.hi);
}

// ---------------------------------------------------------------------------
// Builders

export type Surfaces = {
  background: string;
  foreground: string;
  mutedForeground: string;
  blobs: [string, string, string];
  glassBg: string;
  glassBgStrong: string;
  glassBorder: string;
  overlayColor: string;
  overlayAlpha: number;
  overlayBorder: string;
  surfaceSolid: string;
};

type ModeInput = {
  /** Hue that tints the surfaces. */
  tint: string;
  primary: string;
  accent: string;
  secondary: string;
  /** Raw gradient colors; omit and it is primary to accent. */
  gradient?: string[];
  /** Raw glow color; omit and it is the primary. */
  glow?: string;
  glowSoft?: string;
  /** Replace any generated surface value (used to keep the original two themes pixel-exact). */
  surfaces?: Partial<Surfaces>;
  /** Force the text-on-accent color. */
  textOnAccent?: string;
  /** The page background as colors derived from the final background (omit for a flat page). */
  pageStops?: (background: string, scale: number) => string[];
  /** Mix amounts for the blobs / page gradient (gradient themes want stronger washes). */
  wash?: number;
};

const DARK_SHADOW = "0 8px 32px -8px rgba(0, 0, 0, 0.45), 0 2px 8px -2px rgba(0, 0, 0, 0.3)";
const LIGHT_SHADOW = "0 8px 32px -8px rgba(60, 40, 70, 0.22), 0 2px 8px -2px rgba(60, 40, 70, 0.12)";

const rgba = (hex: string, a: number) => `rgba(${rgbTriple(hex)}, ${a})`;

export function defaultSurfaces(mode: ColorMode, tint: string, blobSources: [string, string, string], wash = 1): Surfaces {
  if (mode === "dark") {
    const background = mix("#08080a", tint, 0.1);
    const base = mix("#ffffff", tint, 0.08);
    return {
      background,
      foreground: mix("#ffffff", tint, 0.07),
      mutedForeground: mix("#ffffff", tint, 0.18),
      blobs: [mix(background, blobSources[0], 0.26 * wash), mix(background, blobSources[1], 0.12 * wash), mix(background, blobSources[2], 0.2 * wash)],
      glassBg: rgba(base, 0.07),
      glassBgStrong: rgba(base, 0.11),
      glassBorder: rgba(base, 0.14),
      overlayColor: background,
      overlayAlpha: 0.82,
      overlayBorder: rgba(base, 0.18),
      surfaceSolid: mix(background, "#ffffff", 0.09),
    };
  }
  const background = mix("#ffffff", tint, 0.06);
  return {
    background,
    foreground: mix("#101012", tint, 0.1),
    mutedForeground: mix("#474750", tint, 0.1),
    blobs: [mix(background, blobSources[0], 0.3 * wash), mix(background, blobSources[1], 0.16 * wash), mix(background, blobSources[2], 0.24 * wash)],
    glassBg: "rgba(255, 255, 255, 0.62)",
    glassBgStrong: "rgba(255, 255, 255, 0.78)",
    glassBorder: rgba(mix("#000000", tint, 0.25), 0.14),
    overlayColor: mix("#ffffff", tint, 0.03),
    overlayAlpha: 0.92,
    overlayBorder: rgba(mix("#000000", tint, 0.25), 0.2),
    surfaceSolid: mix("#ffffff", tint, 0.04),
  };
}

const STATUS = {
  dark: { online: "#4ade80", offline: "#f87171", syncing: "#fbbf24" },
  light: { online: "#15803d", offline: "#b91c1c", syncing: "#b45309" },
};

/** Washes of the gradient into the page are scaled down until body text clears this, so the guard's 4.5:1 holds with room. */
const TEXT_SAFE = 4.6;
const WASH_SCALES = [1, 0.85, 0.7, 0.55, 0.42, 0.32, 0.22];

export function buildTokens(mode: ColorMode, input: ModeInput): ThemeTokens {
  let last!: ThemeTokens;
  for (const scale of WASH_SCALES) {
    last = assembleTokens(mode, input, scale);
    const worstText = Math.min(
      ...textSurfaces(last).flatMap((bg) => [contrastRatio(last.foreground, bg), contrastRatio(last.mutedForeground, bg)])
    );
    if (worstText >= TEXT_SAFE) return last;
  }
  return last; // the guard will say so if even the faintest wash can't be read
}

function assembleTokens(mode: ColorMode, input: ModeInput, scale: number): ThemeTokens {
  const rawGradient = input.gradient ?? [input.primary, input.accent];
  const blobSources: [string, string, string] =
    rawGradient.length >= 2
      ? [rawGradient[0], rawGradient[rawGradient.length - 1], rawGradient[Math.floor(rawGradient.length / 2)]]
      : [input.primary, input.tint, input.secondary];
  const solidBlobs: [string, string, string] = [input.primary, input.tint, input.secondary];
  const surfaces = { ...defaultSurfaces(mode, input.tint, input.gradient ? blobSources : solidBlobs, (input.wash ?? 1) * scale), ...input.surfaces };
  const { background } = surfaces;
  const pageStops = input.pageStops ? input.pageStops(background, scale) : [background];
  // Buttons and gradients must clear 3:1 against the page everywhere, so fit against its lightest (dark mode) or darkest (light mode) point.
  const byLuminance = [background, ...pageStops].sort((a, b) => luminance(a) - luminance(b));
  const pageRef = mode === "dark" ? byLuminance[byLuminance.length - 1] : byLuminance[0];

  // Light mode always carries white text (deep, saturated fills); dark mode takes whichever of white / near-black costs less.
  const texts = input.textOnAccent ? [input.textOnAccent] : mode === "light" ? [WHITE] : [WHITE, INK];
  const fitted = fitGradient(rawGradient, pageRef, texts);
  const primary = fitted.stops[0];
  const accent = fitted.stops[fitted.stops.length - 1];
  const secondary = fitToPage(input.secondary, pageRef);

  const base: ThemeTokens = {
    colorScheme: mode,
    background,
    foreground: surfaces.foreground,
    mutedForeground: surfaces.mutedForeground,
    primary,
    primaryForeground: fitted.text,
    secondary,
    accent,
    gradient: fitted.stops,
    glow: rgbTriple(input.glow ?? input.primary),
    glowSoft: rgbTriple(input.glowSoft ?? input.secondary),
    surfaceTint: rgbTriple(input.tint),
    blobs: surfaces.blobs,
    pageStops,
    glassBg: surfaces.glassBg,
    glassBgStrong: surfaces.glassBgStrong,
    glassBorder: surfaces.glassBorder,
    glassShadow: mode === "dark" ? DARK_SHADOW : LIGHT_SHADOW,
    overlayColor: surfaces.overlayColor,
    overlayAlpha: surfaces.overlayAlpha,
    overlayBorder: surfaces.overlayBorder,
    surfaceSolid: surfaces.surfaceSolid,
    focusRing: accent,
    tint: mode === "dark" ? "255, 255, 255" : "0, 0, 0",
    statusOnline: STATUS[mode].online,
    statusOffline: STATUS[mode].offline,
    statusSyncing: STATUS[mode].syncing,
  };

  // The focus ring must clear 3:1 against every surface it can land on, so it's fitted against the
  // lightest (dark mode) or darkest (light mode) of them, starting from the theme's own accent hue.
  const lums = uiSurfaces(base).map((c) => luminance(c));
  const ringWindow =
    mode === "dark" ? luminanceWindow(Math.max(...lums), UI_RATIO, "lighter") : luminanceWindow(Math.min(...lums), UI_RATIO, "darker");
  base.focusRing = fitLuminance(mix(input.primary, input.accent, 0.5), ringWindow.lo, ringWindow.hi);
  return base;
}

// ---------------------------------------------------------------------------
// Theme factories

const rgbOf = (hex: string) => rgbTriple(parseHex(hex));

type SolidModes = { tint?: string; primary: string; accent: string; secondary: string; glow?: string; surfaces?: Partial<Surfaces>; textOnAccent?: string };

export function solidTheme(spec: {
  id: string;
  name: string;
  tagline: string;
  /** Used for both modes unless a mode overrides it. */
  primary: string;
  accent: string;
  secondary: string;
  tint?: string;
  glow?: string;
  dark?: Partial<SolidModes>;
  light?: Partial<SolidModes>;
}): ThemeDefinition {
  const mk = (mode: ColorMode) => {
    const o = (mode === "dark" ? spec.dark : spec.light) ?? {};
    const primary = o.primary ?? spec.primary;
    const accent = o.accent ?? spec.accent;
    return buildTokens(mode, {
      tint: o.tint ?? spec.tint ?? primary,
      primary,
      accent,
      secondary: o.secondary ?? spec.secondary,
      glow: o.glow ?? spec.glow,
      surfaces: o.surfaces,
      textOnAccent: o.textOnAccent,
    });
  };
  const dark = mk("dark");
  const light = mk("light");
  return {
    id: spec.id,
    name: spec.name,
    kind: "solid",
    tagline: spec.tagline,
    accents: [spec.primary, spec.secondary, spec.accent],
    gradientStops: [spec.primary, spec.accent],
    glowColor: spec.glow ? rgbOf(spec.glow) : rgbOf(spec.primary),
    glassTint: rgbOf(spec.tint ?? spec.primary),
    textOnAccent: { dark: spec.dark?.textOnAccent, light: spec.light?.textOnAccent },
    backgroundGradient: { dark: dark.blobs.slice(), light: light.blobs.slice() },
    tokens: { light, dark },
  };
}

export function gradientTheme(spec: { id: string; name: string; tagline: string; stops: string[]; secondary?: string }): ThemeDefinition {
  const first = spec.stops[0];
  const last = spec.stops[spec.stops.length - 1];
  const tint = mix(first, last, 0.5);
  const secondary = spec.secondary ?? mix(first, last, 0.5);
  const mk = (mode: ColorMode) => {
    // The page itself carries the gradient: the stops, washed into the background.
    const washAmount = mode === "dark" ? 0.3 : 0.28;
    return buildTokens(mode, {
      tint,
      primary: first,
      accent: last,
      secondary,
      gradient: spec.stops,
      wash: 1.5,
      pageStops: (bg, k) => [mix(bg, first, washAmount * k), mix(bg, mix(first, last, 0.5), washAmount * 0.55 * k), mix(bg, last, washAmount * k)],
    });
  };
  const dark = mk("dark");
  const light = mk("light");
  return {
    id: spec.id,
    name: spec.name,
    kind: "gradient",
    tagline: spec.tagline,
    accents: [first, last],
    gradientStops: spec.stops,
    glowColor: rgbOf(first),
    glassTint: rgbOf(tint),
    backgroundGradient: { dark: dark.pageStops, light: light.pageStops },
    tokens: { light, dark },
  };
}

export function flagTheme(spec: { id: string; name: string; tagline: string; stops: string[] }): ThemeDefinition {
  const first = spec.stops[0];
  const last = spec.stops[spec.stops.length - 1];
  // One fixed, dark glass-and-text treatment for every flag, so the stripes can be anything.
  const tint = "#8a8aa8";
  const draft = buildTokens("dark", {
    tint,
    primary: first,
    accent: last,
    secondary: spec.stops[Math.floor(spec.stops.length / 2)],
    gradient: spec.stops,
    glow: spec.stops[Math.floor(spec.stops.length / 2)],
    // The page is the flag's own sequence, deepened so it stays a backdrop and never fights the text.
    pageStops: (bg, k) => spec.stops.map((s) => mix(bg, s, 0.26 * k)),
    wash: 1.6,
  });
  return {
    id: spec.id,
    name: spec.name,
    kind: "flag",
    tagline: spec.tagline,
    accents: spec.stops,
    gradientStops: spec.stops,
    glowColor: draft.glow,
    glassTint: rgbOf(tint),
    backgroundGradient: { dark: draft.pageStops },
    tokens: { fixed: draft },
  };
}
