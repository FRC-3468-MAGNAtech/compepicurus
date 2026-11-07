// The theme registry (P18). Three kinds of theme, one `ThemeDefinition` shape (lib/theme-tokens.ts):
//   solid     one accent family, with a light and a dark token set
//   gradient  a Discord-style two/three-color gradient on the page, buttons, tabs and progress bars; light and dark
//   flag      a pride flag's color sequence; ONE fixed token set, the light/dark choice does not apply
//
// Ids are stored in users/{uid}.themeId and localStorage, so existing ids ("team", "biobuzz") never change.
// To add a theme: add an entry here. The contrast guard (lib/theme-contrast.ts, run by the unit tests and by
// `npm run build`) fails if any mode of it is illegible, and the picker, CSS and e2e test pick it up automatically.

import { flagTheme, gradientTheme, solidTheme, type ThemeDefinition, type ThemeKind } from "./theme-tokens";

export type { ColorMode, ColorModePreference, ThemeDefinition, ThemeKind, ThemeTokens } from "./theme-tokens";
export { hasModes, tokensFor } from "./theme-tokens";

// ---------------------------------------------------------------------------
// Solid

const solid: ThemeDefinition[] = [
  // The two original themes keep their original dark surfaces exactly (the `surfaces` overrides below are the old CSS values).
  solidTheme({
    id: "team",
    name: "Team Colors",
    tagline: "Red & Gold — MAGNAtech default",
    primary: "#e11d3c",
    accent: "#ff7a45",
    secondary: "#f5b400",
    glow: "#e11d3c",
    dark: {
      textOnAccent: "#fff7ed",
      surfaces: {
        background: "#17070c",
        foreground: "#f7ede2",
        mutedForeground: "#c9b8ae",
        blobs: ["#3a0d16", "#1a0a12", "#241102"],
        glassBg: "rgba(255, 255, 255, 0.07)",
        glassBgStrong: "rgba(255, 255, 255, 0.11)",
        glassBorder: "rgba(255, 255, 255, 0.14)",
        overlayColor: "#17070c",
        overlayBorder: "rgba(255, 255, 255, 0.18)",
      },
    },
    light: { textOnAccent: "#fff7ed" },
  }),
  solidTheme({
    id: "biobuzz",
    name: "BIOBUZZ",
    tagline: "Beehive amber & honeycomb",
    primary: "#f5a300",
    accent: "#ffd23f",
    secondary: "#d97706",
    glow: "#f5a300",
    dark: {
      textOnAccent: "#241902",
      surfaces: {
        background: "#16110a",
        foreground: "#fbf1d9",
        mutedForeground: "#cabb98",
        blobs: ["#241902", "#140f08", "#2e2308"],
        glassBg: "rgba(255, 226, 150, 0.06)",
        glassBgStrong: "rgba(255, 226, 150, 0.1)",
        glassBorder: "rgba(255, 214, 120, 0.16)",
        overlayColor: "#16110a",
        overlayBorder: "rgba(255, 214, 120, 0.22)",
      },
    },
    // Amber is too light to carry white text, so the light mode deepens it to a honey brown that can.
    light: { primary: "#b45309", accent: "#d97706", secondary: "#92400e", glow: "#d97706" },
  }),
  solidTheme({ id: "evergreen", name: "Evergreen", tagline: "Forest green", primary: "#16a34a", accent: "#84cc16", secondary: "#a3e635" }),
  solidTheme({ id: "ocean", name: "Ocean", tagline: "Deep blue", primary: "#2563eb", accent: "#06b6d4", secondary: "#38bdf8" }),
  solidTheme({ id: "amethyst", name: "Amethyst", tagline: "Royal purple", primary: "#9333ea", accent: "#c084fc", secondary: "#e879f9" }),
  solidTheme({ id: "blossom", name: "Blossom", tagline: "Soft pink", primary: "#ec4899", accent: "#f9a8d4", secondary: "#fda4af" }),
  // Neutrals: the accent is black / white / gray where the surface lets it be seen, and steps to graphite or ink where it can't
  // (black on a black page, white on a white page), so buttons, rings and glow stay visible in both modes.
  solidTheme({
    id: "obsidian",
    name: "Obsidian",
    tagline: "Black",
    primary: "#18181b",
    accent: "#3f3f46",
    secondary: "#a1a1aa",
    tint: "#52525b",
    dark: { primary: "#71717a", accent: "#a1a1aa", secondary: "#d4d4d8", glow: "#e4e4e7" },
    light: { glow: "#18181b" },
  }),
  solidTheme({
    id: "pearl",
    name: "Pearl",
    tagline: "White",
    primary: "#78716c",
    accent: "#57534e",
    secondary: "#a8a29e",
    tint: "#a8a29e",
    dark: { primary: "#e7e5e4", accent: "#ffffff", secondary: "#d6d3d1", glow: "#f5f5f4" },
    light: { glow: "#78716c" },
  }),
  solidTheme({ id: "slate", name: "Slate", tagline: "Gray", primary: "#475569", accent: "#64748b", secondary: "#94a3b8", tint: "#64748b", dark: { primary: "#64748b", accent: "#94a3b8", secondary: "#cbd5e1" } }),
];

// ---------------------------------------------------------------------------
// Gradients

const gradients: ThemeDefinition[] = [
  gradientTheme({ id: "nebula", name: "Nebula", tagline: "Purple to blue", stops: ["#7c3aed", "#2563eb"] }),
  gradientTheme({ id: "lagoon", name: "Lagoon", tagline: "Blue to green", stops: ["#0ea5e9", "#10b981"] }),
  gradientTheme({ id: "ember", name: "Ember", tagline: "Red to orange", stops: ["#dc2626", "#f97316"] }),
  gradientTheme({ id: "sunset", name: "Sunset", tagline: "Orange to pink", stops: ["#f97316", "#ec4899"] }),
  gradientTheme({ id: "aurora", name: "Aurora", tagline: "Green to purple", stops: ["#10b981", "#8b5cf6"] }),
  gradientTheme({ id: "cotton-candy", name: "Cotton Candy", tagline: "Pink to blue", stops: ["#f472b6", "#60a5fa"] }),
  gradientTheme({ id: "midnight", name: "Midnight", tagline: "Indigo to deep blue", stops: ["#4f46e5", "#1e3a8a"], secondary: "#818cf8" }),
  gradientTheme({ id: "twilight", name: "Twilight", tagline: "Indigo to magenta", stops: ["#6366f1", "#db2777"] }),
  gradientTheme({ id: "glacier", name: "Glacier", tagline: "Cyan to periwinkle", stops: ["#22d3ee", "#818cf8"] }),
  gradientTheme({ id: "citrus", name: "Citrus", tagline: "Lime to gold", stops: ["#84cc16", "#f59e0b"] }),
  gradientTheme({ id: "tropical", name: "Tropical", tagline: "Teal to sunshine", stops: ["#14b8a6", "#facc15"] }),
  gradientTheme({ id: "rose-gold", name: "Rose Gold", tagline: "Rose to amber", stops: ["#fb7185", "#f59e0b"] }),
];

// ---------------------------------------------------------------------------
// Pride flags. Each is the flag's widely recognized color sequence, top to bottom (or hoist to fly).
// Only flags whose colors are well documented are here. Berrisexual and Almond/Verian are deliberately NOT:
// I wasn't certain of their exact colors and a pride flag is not something to guess (docs/ASSUMPTIONS.md, P18).

const flag = (id: string, name: string, stops: string[]): ThemeDefinition => flagTheme({ id: `pride-${id}`, name: `Pride: ${name}`, tagline: "Fixed colors", stops });

const flags: ThemeDefinition[] = [
  flag("rainbow", "Rainbow", ["#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"]),
  // Progress Pride: the chevron (black, brown, light blue, pink, white, from the hoist) then the six stripes.
  flag("progress", "Progress", ["#000000", "#613915", "#74d7ee", "#ffafc8", "#ffffff", "#e40303", "#ff8c00", "#ffed00", "#008026", "#004dff", "#750787"]),
  flag("gay-mlm", "Gay (MLM)", ["#078d70", "#26ceaa", "#98e8c1", "#ffffff", "#7badE2", "#5049cc", "#3d1a78"]),
  flag("lesbian", "Lesbian", ["#d52d00", "#ef7627", "#ff9a56", "#ffffff", "#d162a4", "#b55690", "#a30262"]),
  flag("bisexual", "Bisexual", ["#d60270", "#9b4f96", "#0038a8"]),
  flag("pansexual", "Pansexual", ["#ff218c", "#ffd800", "#21b1ff"]),
  flag("demisexual", "Demisexual", ["#000000", "#ffffff", "#6e0071", "#d2d2d2"]),
  flag("omnisexual", "Omnisexual", ["#fe9ace", "#ff53bf", "#200044", "#6760fe", "#8ea6ff"]),
  flag("transgender", "Transgender", ["#5bcefa", "#f5a9b8", "#ffffff", "#f5a9b8", "#5bcefa"]),
  flag("non-binary", "Non-binary", ["#fcf434", "#ffffff", "#9c59d1", "#2c2c2c"]),
  flag("asexual", "Asexual", ["#000000", "#a3a3a3", "#ffffff", "#800080"]),
  flag("aromantic", "Aromantic", ["#3da542", "#a7d379", "#ffffff", "#a9a9a9", "#000000"]),
  flag("genderfluid", "Genderfluid", ["#ff75a2", "#ffffff", "#be18d6", "#000000", "#333ebd"]),
  flag("genderqueer", "Genderqueer", ["#b57edc", "#ffffff", "#4a8123"]),
  flag("agender", "Agender", ["#000000", "#bcc4c7", "#ffffff", "#b7f684", "#ffffff", "#bcc4c7", "#000000"]),
  flag("polysexual", "Polysexual", ["#f714ba", "#01d66a", "#1594f6"]),
  // The intersex flag is a purple ring on yellow, not stripes: shown as yellow to purple.
  flag("intersex", "Intersex", ["#ffd800", "#7902aa"]),
  flag("bigender", "Bigender", ["#c479a2", "#eda5cd", "#d5c7e8", "#ffffff", "#d5c7e8", "#9ac7e8", "#6d82d1"]),
];

export const themes: ThemeDefinition[] = [...solid, ...gradients, ...flags];

export const defaultThemeId = "team";

export type ThemeGroup = { kind: ThemeKind; label: string; themes: ThemeDefinition[] };

export const themeGroups: ThemeGroup[] = [
  { kind: "solid", label: "Solid", themes: solid },
  { kind: "gradient", label: "Gradients", themes: gradients },
  { kind: "flag", label: "Pride", themes: flags },
];

export function isThemeId(id: unknown): id is string {
  return typeof id === "string" && themes.some((t) => t.id === id);
}

export function getTheme(id: string | undefined | null): ThemeDefinition {
  return themes.find((t) => t.id === id) ?? themes[0];
}

/** Flag themes have no light/dark variant. */
export const isFlagTheme = (id: string | undefined | null) => getTheme(id).kind === "flag";
