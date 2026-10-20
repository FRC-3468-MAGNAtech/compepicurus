"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export const DEFAULT_GLASS_SHADE = 1;
export const GLASS_SHADE_MIN = 0.3;
export const GLASS_SHADE_MAX = 2;

type GlassShadeContextValue = {
  /** Multiplier applied to every glass surface's base alpha (see app/globals.css --glass-shade). 1 = default. */
  shade: number;
  setShade: (value: number) => void;
};

const GlassShadeContext = createContext<GlassShadeContextValue | null>(null);

const STORAGE_KEY = "compepicurus.glass-shade";

function clampShade(value: number) {
  return Math.min(GLASS_SHADE_MAX, Math.max(GLASS_SHADE_MIN, value));
}

export function GlassShadeProvider({ children }: { children: ReactNode }) {
  const [shade, setShadeState] = useState(DEFAULT_GLASS_SHADE);

  useEffect(() => {
    try {
      const stored = Number(localStorage.getItem(STORAGE_KEY));
      if (Number.isFinite(stored) && stored >= GLASS_SHADE_MIN && stored <= GLASS_SHADE_MAX) {
        // Deliberately deferred: SSR has no localStorage, so we render the
        // default first (matching the server + the inline init script) and
        // sync the persisted value in after mount.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setShadeState(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-shade", String(shade));
  }, [shade]);

  const setShade = (value: number) => {
    const clamped = clampShade(value);
    setShadeState(clamped);
    try {
      localStorage.setItem(STORAGE_KEY, String(clamped));
    } catch {
      // ignore storage failures
    }
  };

  return <GlassShadeContext.Provider value={{ shade, setShade }}>{children}</GlassShadeContext.Provider>;
}

export function useGlassShade() {
  const ctx = useContext(GlassShadeContext);
  if (!ctx) throw new Error("useGlassShade must be used within GlassShadeProvider");
  return ctx;
}
