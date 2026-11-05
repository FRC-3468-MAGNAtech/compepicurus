// Pure edit operations on a pick list's ordered `picked` team numbers (P12).
//
// Every change to the shared board is one of these `PickOp`s, applied inside a
// Firestore transaction to the *latest* stored list (lib/pick-list/store.ts) —
// never "write back the array I had on screen". Two people editing at once
// therefore compose (both adds survive) instead of one overwriting the other.
// That's why the ops are expressed relative to teams ("put 254 before 971"),
// not as array indexes that a concurrent edit would invalidate.

/** More than any alliance-selection list could need; also enforced in firestore.rules. */
export const MAX_PICKS = 100;

export type PickOp =
  /** Put `team` in the list immediately before `before` (or at the end if `before` is null / not in the list). Moves it if it's already there. */
  | { type: "place"; team: number; before: number | null }
  | { type: "remove"; team: number }
  /** Swap `team` with its neighbour one step up (-1, higher priority) or down (+1). No-op at the ends or if absent. */
  | { type: "move"; team: number; delta: -1 | 1 }
  | { type: "reset" };

/** Returns a new array; never mutates. Unchanged operations return an equal array. */
export function applyPickOp(picked: readonly number[], op: PickOp): number[] {
  switch (op.type) {
    case "reset":
      return [];
    case "remove":
      return picked.filter((t) => t !== op.team);
    case "move": {
      const i = picked.indexOf(op.team);
      const j = i + op.delta;
      if (i < 0 || j < 0 || j >= picked.length) return [...picked];
      const next = [...picked];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    }
    case "place": {
      const without = picked.filter((t) => t !== op.team);
      const at = op.before === null || op.before === op.team ? -1 : without.indexOf(op.before);
      if (at < 0) without.push(op.team);
      else without.splice(at, 0, op.team);
      return without.slice(0, MAX_PICKS);
    }
  }
}

export function samePicks(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((t, i) => t === b[i]);
}

/** Drops anything that isn't a positive whole team number and de-duplicates, keeping order — a stored list is untrusted input. */
export function sanitizePicks(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<number>();
  const out: number[] = [];
  for (const v of raw) {
    if (typeof v === "number" && Number.isInteger(v) && v > 0 && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.slice(0, MAX_PICKS);
}

/**
 * Converts a finished drag (the list as the user left it) into an op that
 * survives concurrent edits: "put `team` before whatever now follows it".
 */
export function placeOpFromList(result: readonly number[], team: number): PickOp {
  const i = result.indexOf(team);
  return { type: "place", team, before: i >= 0 ? (result[i + 1] ?? null) : null };
}
