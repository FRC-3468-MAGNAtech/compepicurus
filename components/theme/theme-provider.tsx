"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAuth } from "@/lib/auth";
import { getTheme, isFlagTheme, tokensFor, type ColorMode, type ColorModePreference, type ThemeDefinition } from "@/lib/themes";
import {
  COLOR_MODE_STORAGE_KEY,
  GRADIENT_INTENSITY_STORAGE_KEY,
  THEME_STORAGE_KEY,
  effectiveColorMode,
  gradientStrength,
  oppositeMode,
  parseColorModePreference,
  parseGradientIntensity,
  resolveColorModePreference,
  resolveGradientIntensity,
  resolveThemeId,
} from "@/lib/theme-prefs";
import { DEFAULT_GRADIENT_INTENSITY, type GradientIntensity } from "@/lib/theme-gradient";

// Theme + light/dark mode (P18). Two independent settings, both kept per user (users/{uid}.themeId / .colorMode),
// mirrored in this browser's localStorage so they apply before sign-in and before first paint (the inline script in
// app/layout.tsx reads the same keys). Changing one never touches the other. A flag theme is one fixed look, so the
// *applied* mode is "dark" while one is active, but the saved Light/Dark/System choice is left alone and comes back
// the moment a different theme is picked.
//
// Applying a theme only sets two attributes on <html> (data-theme, data-mode); the CSS for every theme already exists
// (lib/theme-css.ts). The brief color fade is a temporary class that transitions color properties on elements, never
// opacity / filter / transform on an ancestor of glass: those turn a parent into a backdrop root and switch the blur
// of every glass layer inside it off. (That, via document.startViewTransition on the root, was the "all blurs vanish
// after picking a theme" bug. See docs/ASSUMPTIONS.md, P18.)

type ThemeContextValue = {
  theme: ThemeDefinition;
  themeId: string;
  setThemeId: (id: string) => void;
  /** The saved choice: light, dark, or follow the system. */
  colorMode: ColorModePreference;
  setColorMode: (mode: ColorModePreference) => void;
  /** What is actually applied right now (always "dark" for a flag theme). */
  resolvedMode: ColorMode;
  /** True while a flag theme is active: the mode controls are disabled. */
  modeLocked: boolean;
  /** The quick sun/moon switch: flips the applied mode by saving an explicit light or dark. */
  toggleColorMode: () => void;
  /** P32: Subtle / Normal / Vivid (default Vivid): how strongly a gradient or pride theme's painted page shows. Saved per user. */
  gradientIntensity: GradientIntensity;
  setGradientIntensity: (intensity: GradientIntensity) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const FADE_CLASS = "theme-animating";
const FADE_MS = 450;

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: the choice still applies for this session
  }
}

const systemPrefersLight = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches;

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { user, profile, updateUserProfile } = useAuth();
  const accountThemeId = profile?.themeId;
  const accountMode = profile?.colorMode;
  const accountIntensity = profile?.gradientIntensity;

  // SSR (and the first client render) assume the defaults, matching the markup; the real values sync in right after mount.
  const [themeId, setThemeIdState] = useState("team");
  const [colorMode, setColorModeState] = useState<ColorModePreference>("system");
  const [gradientIntensity, setGradientIntensityState] = useState<GradientIntensity>(DEFAULT_GRADIENT_INTENSITY);
  const [systemLight, setSystemLight] = useState(false);
  // False until this browser's saved values have been read in, so the defaults above never overwrite them.
  const [ready, setReady] = useState(false);
  const fadeTimer = useRef<number | null>(null);
  const hasApplied = useRef(false);

  useEffect(() => {
    // Deliberately deferred: no localStorage / matchMedia on the server, so the persisted values sync in after mount.
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeIdState(resolveThemeId(null, readLocal(THEME_STORAGE_KEY)));
    setColorModeState(resolveColorModePreference(null, readLocal(COLOR_MODE_STORAGE_KEY)));
    setGradientIntensityState(resolveGradientIntensity(null, readLocal(GRADIENT_INTENSITY_STORAGE_KEY)));
    setSystemLight(systemPrefersLight());
    setReady(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = () => setSystemLight(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // Once the account's profile is known, its saved choices win (they follow the user between devices).
  useEffect(() => {
    if (accountThemeId === undefined && accountMode === undefined) return;
    /* eslint-disable react-hooks/set-state-in-effect */
    setThemeIdState((cur) => resolveThemeId(accountThemeId, cur));
    const parsed = parseColorModePreference(accountMode);
    if (parsed) setColorModeState(parsed);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [accountThemeId, accountMode]);

  useEffect(() => {
    const parsed = parseGradientIntensity(accountIntensity);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (parsed) setGradientIntensityState(parsed);
  }, [accountIntensity]);

  // Gradient intensity: this browser's copy, and the CSS variable the page-gradient layer reads (lib/theme-css.ts sets it pre-paint too).
  useEffect(() => {
    if (!ready) return;
    writeLocal(GRADIENT_INTENSITY_STORAGE_KEY, gradientIntensity);
    document.documentElement.style.setProperty("--gradient-strength", String(gradientStrength(gradientIntensity)));
  }, [ready, gradientIntensity]);

  const resolvedMode = effectiveColorMode(themeId, colorMode, systemLight);
  const theme = useMemo(() => getTheme(themeId), [themeId]);

  // Mirror to this browser, and put it on <html>.
  useEffect(() => {
    if (!ready) return;
    writeLocal(THEME_STORAGE_KEY, themeId);
    writeLocal(COLOR_MODE_STORAGE_KEY, colorMode);
    const el = document.documentElement;
    const animate = hasApplied.current && (el.getAttribute("data-theme") !== themeId || el.getAttribute("data-mode") !== resolvedMode);
    hasApplied.current = true;
    if (animate && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      el.classList.add(FADE_CLASS);
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
      fadeTimer.current = window.setTimeout(() => {
        el.classList.remove(FADE_CLASS);
        fadeTimer.current = null;
      }, FADE_MS);
    }
    el.setAttribute("data-theme", themeId);
    el.setAttribute("data-mode", resolvedMode);
    // The browser chrome (address bar, iOS status bar) follows the page.
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", tokensFor(getTheme(themeId), resolvedMode).background);
  }, [ready, themeId, colorMode, resolvedMode]);

  useEffect(
    () => () => {
      if (fadeTimer.current !== null) window.clearTimeout(fadeTimer.current);
    },
    []
  );

  const save = useCallback(
    (patch: { themeId?: string; colorMode?: ColorModePreference; gradientIntensity?: GradientIntensity }) => {
      if (!user) return; // signed out (the marketing pages): this browser's copy is all there is
      updateUserProfile(patch).catch((err) => console.error("couldn't save the appearance settings:", err));
    },
    [user, updateUserProfile]
  );

  const setThemeId = useCallback(
    (id: string) => {
      const next = getTheme(id).id;
      setThemeIdState(next);
      save({ themeId: next });
    },
    [save]
  );

  const setColorMode = useCallback(
    (mode: ColorModePreference) => {
      setColorModeState(mode);
      save({ colorMode: mode });
    },
    [save]
  );

  const setGradientIntensity = useCallback(
    (intensity: GradientIntensity) => {
      setGradientIntensityState(intensity);
      save({ gradientIntensity: intensity });
    },
    [save]
  );

  const modeLocked = isFlagTheme(themeId);
  const toggleColorMode = useCallback(() => {
    if (modeLocked) return;
    setColorMode(oppositeMode(resolvedMode));
  }, [modeLocked, resolvedMode, setColorMode]);

  const value = useMemo(
    () => ({ theme, themeId, setThemeId, colorMode, setColorMode, resolvedMode, modeLocked, toggleColorMode, gradientIntensity, setGradientIntensity }),
    [theme, themeId, setThemeId, colorMode, setColorMode, resolvedMode, modeLocked, toggleColorMode, gradientIntensity, setGradientIntensity]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within ThemeProvider");
  return ctx;
}
