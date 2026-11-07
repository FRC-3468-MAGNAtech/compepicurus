// P22: undo/redo as a pure value: the builder keeps `History<Form>`; every edit is a `push`, Ctrl+Z / Ctrl+Y are `undo` / `redo`.
// Typing in a text box produces one edit per keystroke, so edits that share a `coalesceKey` within a short window collapse into one undo step.

export type History<T> = {
  past: T[];
  present: T;
  future: T[];
  /** The coalescing key and time of the last push, so a burst of edits to one thing is one undo step. */
  lastKey: string | null;
  lastAt: number;
};

export const HISTORY_LIMIT = 100;
export const COALESCE_WINDOW_MS = 1200;

export function createHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], lastKey: null, lastAt: 0 };
}

export function pushHistory<T>(h: History<T>, next: T, opts: { coalesceKey?: string; now?: number; windowMs?: number; limit?: number } = {}): History<T> {
  if (Object.is(next, h.present)) return h;
  const now = opts.now ?? Date.now();
  const key = opts.coalesceKey ?? null;
  const merge = key !== null && key === h.lastKey && now - h.lastAt < (opts.windowMs ?? COALESCE_WINDOW_MS) && h.past.length > 0;
  if (merge) return { ...h, present: next, future: [], lastAt: now };
  const past = [...h.past, h.present];
  const limit = opts.limit ?? HISTORY_LIMIT;
  return { past: past.length > limit ? past.slice(past.length - limit) : past, present: next, future: [], lastKey: key, lastAt: now };
}

export const canUndo = <T,>(h: History<T>): boolean => h.past.length > 0;
export const canRedo = <T,>(h: History<T>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h;
  const previous = h.past[h.past.length - 1];
  // the next edit must start a fresh step, never merge into the one just undone
  return { past: h.past.slice(0, -1), present: previous, future: [h.present, ...h.future], lastKey: null, lastAt: 0 };
}

export function redo<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h;
  const [next, ...rest] = h.future;
  return { past: [...h.past, h.present], present: next, future: rest, lastKey: null, lastAt: 0 };
}

/** Replaces the present without recording an undo step (e.g. restoring from the saved draft on load). */
export function resetHistory<T>(present: T): History<T> {
  return createHistory(present);
}
