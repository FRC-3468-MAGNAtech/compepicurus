// The contrast guard (P18): WCAG contrast for every theme x mode, measured on the final tokens (not on the
// inputs that built them). Used by lib/themes.test.ts (vitest) and by `npm run check:themes`, which
// `npm run build` runs first, so a theme that can't be read fails the deploy.
//
//   body text (foreground, muted) on glass / page / overlay / solid surfaces   4.5:1
//   text on accent buttons (every point of the gradient, primary, accent)      4.5:1
//   UI elements: fills vs the page, focus ring vs every surface, status dots   3:1

import { contrastRatio, sampleGradient } from "./theme-color";
import { hasModes, themes, tokensFor, type ColorMode, type ThemeDefinition, type ThemeTokens } from "./themes";
import { textSurfaces, uiSurfaces } from "./theme-tokens";

export const TEXT_MIN = 4.5;
export const UI_MIN = 3;

export type ContrastCheck = {
  theme: string;
  mode: ColorMode | "fixed";
  rule: string;
  /** The lowest ratio found for this rule. */
  ratio: number;
  min: number;
  ok: boolean;
  /** The pair that produced the lowest ratio. */
  worst: string;
};

function worstOf(label: string, items: { name: string; fg: string; bg: string }[]) {
  let low = Infinity;
  let worst = "";
  for (const { name, fg, bg } of items) {
    const r = contrastRatio(fg, bg);
    if (r < low) {
      low = r;
      worst = `${name}: ${fg} on ${bg}`;
    }
  }
  return { label, ratio: low, worst };
}

export function auditTokens(themeId: string, mode: ColorMode | "fixed", t: ThemeTokens): ContrastCheck[] {
  const text = textSurfaces(t);
  const ui = uiSurfaces(t);
  const fills = sampleGradient(t.gradient, 41).concat(t.primary, t.accent);
  const page = [t.background, ...t.pageStops];

  const rules: { rule: string; min: number; r: { ratio: number; worst: string } }[] = [
    { rule: "body text on glass, page, overlay and solid surfaces", min: TEXT_MIN, r: worstOf("fg", text.map((bg) => ({ name: "foreground", fg: t.foreground, bg }))) },
    { rule: "muted text on glass, page, overlay and solid surfaces", min: TEXT_MIN, r: worstOf("muted", text.map((bg) => ({ name: "muted", fg: t.mutedForeground, bg }))) },
    { rule: "text on accent buttons (whole gradient, primary, accent)", min: TEXT_MIN, r: worstOf("onAccent", fills.map((bg) => ({ name: "text-on-accent", fg: t.primaryForeground, bg }))) },
    { rule: "accent fills against the page", min: UI_MIN, r: worstOf("fills", fills.flatMap((fg) => page.map((bg) => ({ name: "fill", fg, bg })))) },
    { rule: "secondary color against the page", min: UI_MIN, r: worstOf("secondary", page.map((bg) => ({ name: "secondary", fg: t.secondary, bg }))) },
    { rule: "focus ring on every surface", min: UI_MIN, r: worstOf("ring", ui.map((bg) => ({ name: "focus ring", fg: t.focusRing, bg }))) },
    {
      rule: "connection status dots on the solid chip",
      min: UI_MIN,
      r: worstOf(
        "status",
        [t.statusOnline, t.statusOffline, t.statusSyncing].map((fg) => ({ name: "status dot", fg, bg: t.surfaceSolid }))
      ),
    },
  ];
  return rules.map(({ rule, min, r }) => ({ theme: themeId, mode, rule, ratio: r.ratio, min, ok: r.ratio >= min, worst: r.worst }));
}

export function auditTheme(theme: ThemeDefinition): ContrastCheck[] {
  if (hasModes(theme)) {
    return [...auditTokens(theme.id, "light", tokensFor(theme, "light")), ...auditTokens(theme.id, "dark", tokensFor(theme, "dark"))];
  }
  return auditTokens(theme.id, "fixed", tokensFor(theme, "dark"));
}

export function auditAllThemes(): ContrastCheck[] {
  return themes.flatMap(auditTheme);
}

export function failures(checks: ContrastCheck[]): ContrastCheck[] {
  return checks.filter((c) => !c.ok);
}

export function formatFailures(checks: ContrastCheck[]): string {
  return failures(checks)
    .map((c) => `  ${c.theme} (${c.mode}) · ${c.rule}: ${c.ratio.toFixed(2)}:1, needs ${c.min}:1 — worst ${c.worst}`)
    .join("\n");
}
