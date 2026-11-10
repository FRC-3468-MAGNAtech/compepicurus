// How a saved theme + mode preference becomes what is on screen (P18). Pure, so it is unit tested and so
// the pre-paint script (lib/theme-css.ts) and the provider apply exactly the same rules.

import { defaultThemeId, isFlagTheme, isThemeId, type ColorMode, type ColorModePreference } from "@/lib/themes";
import { DEFAULT_GRADIENT_INTENSITY, INTENSITY_STRENGTH, type GradientIntensity } from "@/lib/theme-gradient";

export const THEME_STORAGE_KEY = "compepicurus.theme";
export const COLOR_MODE_STORAGE_KEY = "compepicurus.colorMode";

export const DEFAULT_COLOR_MODE: ColorModePreference = "system";

// P32: Gradient intensity (Settings > Appearance): Subtle / Normal / Vivid, default Vivid, saved per user (users/{uid}.gradientIntensity)
// and mirrored in this browser so it applies before first paint. It is the opacity of the painted page over the plain background
// (the `--gradient-strength` CSS variable); solid themes paint the plain background, so it changes nothing for them.
export const GRADIENT_INTENSITY_STORAGE_KEY = "compepicurus.gradientIntensity";

export function parseGradientIntensity(value: unknown): GradientIntensity | null {
  return value === "subtle" || value === "normal" || value === "vivid" ? value : null;
}

/** The account's choice wins when valid; otherwise this browser's; otherwise Vivid. */
export function resolveGradientIntensity(accountValue: unknown, localValue: unknown): GradientIntensity {
  return parseGradientIntensity(accountValue) ?? parseGradientIntensity(localValue) ?? DEFAULT_GRADIENT_INTENSITY;
}

/** The value of `--gradient-strength` for an intensity. */
export const gradientStrength = (intensity: GradientIntensity): number => INTENSITY_STRENGTH[intensity];

export function parseColorModePreference(value: unknown): ColorModePreference | null {
  return value === "light" || value === "dark" || value === "system" ? value : null;
}

/** "system" follows the device; the device default is dark when the browser can't say. */
export function resolveColorMode(pref: ColorModePreference, systemPrefersLight: boolean): ColorMode {
  if (pref === "system") return systemPrefersLight ? "light" : "dark";
  return pref;
}

/** What the page really uses. A flag theme is one fixed look, so it is "dark" whatever was chosen (the choice itself is kept). */
export function effectiveColorMode(themeId: string, pref: ColorModePreference, systemPrefersLight: boolean): ColorMode {
  return isFlagTheme(themeId) ? "dark" : resolveColorMode(pref, systemPrefersLight);
}

/** The account's choice wins when it is a real theme; otherwise this browser's; otherwise the default. */
export function resolveThemeId(accountValue: unknown, localValue: unknown): string {
  if (isThemeId(accountValue)) return accountValue;
  if (isThemeId(localValue)) return localValue;
  return defaultThemeId;
}

export function resolveColorModePreference(accountValue: unknown, localValue: unknown): ColorModePreference {
  return parseColorModePreference(accountValue) ?? parseColorModePreference(localValue) ?? DEFAULT_COLOR_MODE;
}

/** What the quick sun/moon toggle sets: the opposite of what is showing now. */
export function oppositeMode(current: ColorMode): ColorMode {
  return current === "dark" ? "light" : "dark";
}
