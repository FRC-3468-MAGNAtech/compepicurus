export type Difficulty = "easy" | "medium" | "hard";

/** Thresholds live here, in one place, so tuning them later doesn't mean hunting through call sites. */
export const DIFFICULTY_THRESHOLDS = {
  /** <= this is "easy". */
  easyMax: 40,
  /** <= this (and > easyMax) is "medium"; anything higher is "hard". */
  mediumMax: 79,
};

export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: "Easy",
  medium: "Medium",
  hard: "Hard",
};

// Fixed semantic colors, same convention as lib/accuracy/engine.ts's status
// tiers and lib/roles.ts — written as complete literal class names so
// Tailwind's compiler picks them up.
export const DIFFICULTY_CLASSNAMES: Record<Difficulty, string> = {
  easy: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30",
  medium: "bg-amber-500/15 text-amber-300 border border-amber-400/30",
  hard: "bg-red-500/15 text-red-300 border border-red-400/30",
};

/** Difficulty is computed per alliance, from that alliance's own official score. */
export function getDifficulty(officialAllianceScore: number): Difficulty {
  if (officialAllianceScore <= DIFFICULTY_THRESHOLDS.easyMax) return "easy";
  if (officialAllianceScore <= DIFFICULTY_THRESHOLDS.mediumMax) return "medium";
  return "hard";
}
