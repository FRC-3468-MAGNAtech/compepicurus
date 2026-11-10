// Turns the theme registry into the CSS the page runs on (P18). Rendered once, server-side, into a <style>
// in <head> (app/layout.tsx), so every theme's variables exist before first paint, and no theme can be
// missing a variable: every rule is generated from the same complete `ThemeTokens` shape.
//
// Selectors: solid and gradient themes get `html[data-theme="id"][data-mode="light|dark"]`; a flag theme gets
// `html[data-theme="id"]` alone, because it has one fixed token set. The default (Team Colors, dark) is also `:root`.

import { defaultThemeId, themes } from "@/lib/themes";
import { hasModes, pageBackground, type ThemeDefinition, type ThemeTokens } from "@/lib/theme-tokens";
import { COLOR_MODE_STORAGE_KEY, GRADIENT_INTENSITY_STORAGE_KEY, THEME_STORAGE_KEY } from "@/lib/theme-prefs";
import { INTENSITY_STRENGTH } from "@/lib/theme-gradient";

/** One theme's variables, as the body of a CSS rule. */
export function tokensToCss(t: ThemeTokens): string {
  const vars: Record<string, string> = {
    "color-scheme": t.colorScheme,
    "--background": t.background,
    "--foreground": t.foreground,
    "--muted-foreground": t.mutedForeground,
    "--color-primary": t.primary,
    "--color-primary-foreground": t.primaryForeground,
    "--color-secondary": t.secondary,
    "--color-accent": t.accent,
    // --theme-gradient and --theme-gradient-h are built from this once, in globals.css.
    "--theme-stops": t.gradient.join(","),
    "--glow": t.glow,
    "--glow-soft": t.glowSoft,
    "--surface-tint": t.surfaceTint,
    "--blob-1": t.blobs[0],
    "--blob-2": t.blobs[1],
    "--blob-3": t.blobs[2],
    "--page-bg": pageBackground(t),
    "--glass-bg": t.glassBg,
    "--glass-bg-strong": t.glassBgStrong,
    "--glass-border": t.glassBorder,
    "--glass-shadow": t.glassShadow,
    "--overlay-bg": `rgba(${hexTriple(t.overlayColor)}, calc(${t.overlayAlpha} * var(--glass-shade)))`,
    "--overlay-border": t.overlayBorder,
    "--surface-solid": t.surfaceSolid,
    "--focus-ring": t.focusRing,
    "--tint-rgb": t.tint,
    "--status-online": t.statusOnline,
    "--status-offline": t.statusOffline,
    "--status-syncing": t.statusSyncing,
  };
  return Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
}

function hexTriple(hex: string): string {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)).join(", ");
}

function rulesFor(theme: ThemeDefinition): string[] {
  if (!hasModes(theme)) {
    const fixed = (theme.tokens as { fixed: ThemeTokens }).fixed;
    return [`html[data-theme="${theme.id}"]{${tokensToCss(fixed)}}`];
  }
  const out = [
    `html[data-theme="${theme.id}"][data-mode="dark"]{${tokensToCss(theme.tokens.dark)}}`,
    `html[data-theme="${theme.id}"][data-mode="light"]{${tokensToCss(theme.tokens.light)}}`,
  ];
  // The default theme in its dark mode doubles as :root, so nothing is ever unthemed (a stray page, an error screen).
  if (theme.id === defaultThemeId) out.unshift(`:root{${tokensToCss(theme.tokens.dark)}}`);
  return out;
}

/** The whole registry as one stylesheet. Server-side only: it's a few tens of KB and never needed on the client. */
export function themeCss(): string {
  return themes.flatMap(rulesFor).join("\n");
}

/**
 * Runs in <head> before first paint: sets data-theme and data-mode from this browser's saved choice (and the system
 * preference), so there is never a flash of the wrong theme. Mirrors lib/theme-prefs.ts. The signed-in account's
 * saved values are applied by ThemeProvider as soon as the profile loads.
 */
export function themeInitScript(): string {
  const ids = JSON.stringify(themes.map((t) => t.id));
  const flagIds = JSON.stringify(themes.filter((t) => t.kind === "flag").map((t) => t.id));
  return `(function(){try{
var ids=${ids},flags=${flagIds},de=document.documentElement;
var g=function(k){try{return localStorage.getItem(k)}catch(e){return null}};
var t=g(${JSON.stringify(THEME_STORAGE_KEY)});
if(ids.indexOf(t)<0)t=${JSON.stringify(defaultThemeId)};
var p=g(${JSON.stringify(COLOR_MODE_STORAGE_KEY)});
if(p!=="light"&&p!=="dark"&&p!=="system")p="system";
var m=p==="system"?(window.matchMedia&&matchMedia("(prefers-color-scheme: light)").matches?"light":"dark"):p;
if(flags.indexOf(t)>=0)m="dark";
de.setAttribute("data-theme",t);de.setAttribute("data-mode",m);
var s=parseFloat(g("compepicurus.glass-shade"));
if(s>=0.3&&s<=2)de.style.setProperty("--glass-shade",String(s));
var gm=${JSON.stringify(INTENSITY_STRENGTH)},gk=g(${JSON.stringify(GRADIENT_INTENSITY_STORAGE_KEY)});
if(gk&&Object.prototype.hasOwnProperty.call(gm,gk))de.style.setProperty("--gradient-strength",String(gm[gk]));
}catch(e){}})();`;
}
