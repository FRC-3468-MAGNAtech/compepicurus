"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { doc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/lib/auth";
import { db, isFirebaseConfigured } from "@/lib/firebase/client";
import {
  GLASS_LAYER_DEFAULT,
  GLASS_LAYER_STORAGE_KEY,
  clampGlassLayerLevel,
  isGlassLayerLevel,
  parseStoredLevel,
  resolveGlassLayerLevel,
  shouldSaveLocalLevelToProfile,
} from "@/lib/glass-layer-level";

// The one shared state for the layered-glass level (FIX3). Every slider in the app —
// the sidebar's droplet popover, the top bar's, the home page's — reads and writes it
// through `useGlassLayerLevel()`, so they are always in sync. It is applied app-wide as
// the `--glass-shade` CSS multiplier, remembered in this browser (so it applies before
// sign-in and instantly on load), and saved to the signed-in user's own doc
// (`users/{uid}.glassLayerLevel`) so it follows them across devices.

type GlassLayerContextValue = {
  /** Multiplier on every glass surface's base opacity. 1 = the default look. */
  level: number;
  setLevel: (value: number) => void;
  reset: () => void;
};

const GlassLayerContext = createContext<GlassLayerContextValue | null>(null);

/** Slider drags fire constantly; the user doc is only written once they pause. */
const SAVE_DEBOUNCE_MS = 500;

function readLocal(): number | null {
  try {
    return parseStoredLevel(localStorage.getItem(GLASS_LAYER_STORAGE_KEY));
  } catch {
    return null; // storage blocked: the default (or the account's level) is fine
  }
}

export function GlassLayerProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const uid = user?.uid ?? null;
  const profileLevel = profile?.glassLayerLevel;
  const profileLoaded = profile !== null;

  const [level, setLevelState] = useState(GLASS_LAYER_DEFAULT);
  const saveTimer = useRef<number | null>(null);
  const pendingSave = useRef<{ uid: string; value: number } | null>(null);
  const migratedFor = useRef<string | null>(null);

  const persist = useCallback(
    (value: number) => {
      try {
        localStorage.setItem(GLASS_LAYER_STORAGE_KEY, String(value));
      } catch {
        // storage blocked: still applies for this session
      }
      if (!uid || !isFirebaseConfigured()) return;
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      pendingSave.current = { uid, value };
      saveTimer.current = window.setTimeout(() => {
        saveTimer.current = null;
        pendingSave.current = null;
        updateDoc(doc(db, "users", uid), { glassLayerLevel: value }).catch((err) => console.error("couldn't save the glass level to the user doc:", err));
      }, SAVE_DEBOUNCE_MS);
    },
    [uid]
  );

  // On load: this browser's remembered level (SSR renders the default, matching the inline init script, then syncs in).
  useEffect(() => {
    const local = readLocal();
    if (local !== null) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLevelState(local);
    }
  }, []);

  // Once the profile is known, the account's level wins; a level only this browser had is saved to the account once.
  useEffect(() => {
    if (!profileLoaded || !uid) return;
    const local = readLocal();
    const resolved = resolveGlassLayerLevel(profileLevel, local);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLevelState(resolved);
    if (isGlassLayerLevel(profileLevel)) {
      try {
        localStorage.setItem(GLASS_LAYER_STORAGE_KEY, String(profileLevel)); // mirror, so the next cold load has it instantly
      } catch {
        // ignore
      }
    } else if (shouldSaveLocalLevelToProfile(profileLevel, local) && migratedFor.current !== uid) {
      migratedFor.current = uid;
      persist(resolved);
    }
  }, [profileLoaded, uid, profileLevel, persist]);

  useEffect(() => {
    document.documentElement.style.setProperty("--glass-shade", String(level));
  }, [level]);

  // A pending debounced save shouldn't be lost if the provider unmounts: write it now.
  useEffect(
    () => () => {
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
      const pending = pendingSave.current;
      if (pending && isFirebaseConfigured()) {
        updateDoc(doc(db, "users", pending.uid), { glassLayerLevel: pending.value }).catch(() => {});
      }
    },
    []
  );

  const setLevel = useCallback(
    (value: number) => {
      const clamped = clampGlassLayerLevel(value);
      setLevelState(clamped);
      persist(clamped);
    },
    [persist]
  );
  const reset = useCallback(() => setLevel(GLASS_LAYER_DEFAULT), [setLevel]);

  const value = useMemo(() => ({ level, setLevel, reset }), [level, setLevel, reset]);
  return <GlassLayerContext.Provider value={value}>{children}</GlassLayerContext.Provider>;
}

export function useGlassLayerLevel() {
  const ctx = useContext(GlassLayerContext);
  if (!ctx) throw new Error("useGlassLayerLevel must be used within GlassLayerProvider");
  return ctx;
}
