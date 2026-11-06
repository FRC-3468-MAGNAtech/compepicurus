// The "layered glass" level (FIX3): one number that scales how much shading a glass
// box gets, which matters most when glass boxes sit on top of other glass boxes.
// It is applied app-wide as the `--glass-shade` CSS multiplier (see app/globals.css),
// and persisted per user. Pure helpers here; the React state is lib/glass-layer.tsx.

export const GLASS_LAYER_DEFAULT = 1;
export const GLASS_LAYER_MIN = 0.3;
export const GLASS_LAYER_MAX = 2;
export const GLASS_LAYER_STEP = 0.05;

/** The localStorage key — unchanged from before FIX3, so a level someone already chose carries over, and the inline init script in app/layout.tsx still reads it. */
export const GLASS_LAYER_STORAGE_KEY = "compepicurus.glass-shade";

export const isGlassLayerLevel = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= GLASS_LAYER_MIN && value <= GLASS_LAYER_MAX;

export const clampGlassLayerLevel = (value: number): number => (Number.isFinite(value) ? Math.min(GLASS_LAYER_MAX, Math.max(GLASS_LAYER_MIN, value)) : GLASS_LAYER_DEFAULT);

/** A stored string back to a level, or null when absent or out of range. */
export function parseStoredLevel(raw: string | null | undefined): number | null {
  if (raw === null || raw === undefined || raw.trim() === "") return null;
  const n = Number(raw);
  return isGlassLayerLevel(n) ? n : null;
}

/**
 * Which level applies: the signed-in user's saved level (so it follows them to
 * another device), else this browser's remembered one, else the default.
 */
export function resolveGlassLayerLevel(profileLevel: unknown, localLevel: number | null): number {
  if (isGlassLayerLevel(profileLevel)) return profileLevel;
  if (localLevel !== null) return localLevel;
  return GLASS_LAYER_DEFAULT;
}

/** A level only this browser knows about (the user has none saved yet) should be saved to their account once. */
export const shouldSaveLocalLevelToProfile = (profileLevel: unknown, localLevel: number | null): boolean => !isGlassLayerLevel(profileLevel) && localLevel !== null;

/** "85%" for the slider's readout. */
export const formatGlassLayerLevel = (level: number): string => `${Math.round(level * 100)}%`;
