"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { defaultThemeId, themes, type Theme } from "@/lib/themes";

type ThemeContextValue = {
  theme: Theme;
  themeId: string;
  setThemeId: (id: string) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

const STORAGE_KEY = "compepicurus.theme";

type DocumentWithViewTransition = Document & {
  startViewTransition?: (callback: () => void) => void;
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState(defaultThemeId);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored && themes.some((t) => t.id === stored)) {
        // Deliberately deferred: SSR has no localStorage, so we render the
        // default first (matching the server) and sync the persisted value
        // in after mount rather than risk a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setThemeIdState(stored);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeId);
  }, [themeId]);

  const setThemeId = (id: string) => {
    const apply = () => {
      setThemeIdState(id);
      try {
        localStorage.setItem(STORAGE_KEY, id);
      } catch {
        // ignore
      }
    };

    const doc = document as DocumentWithViewTransition;
    if (doc.startViewTransition) {
      doc.startViewTransition(apply);
    } else {
      apply();
    }
  };

  const theme = themes.find((t) => t.id === themeId) ?? themes[0];

  return (
    <ThemeContext.Provider value={{ theme, themeId, setThemeId }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useAppTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useAppTheme must be used within ThemeProvider");
  return ctx;
}
