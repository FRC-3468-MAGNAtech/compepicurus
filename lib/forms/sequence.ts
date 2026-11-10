import type { SequenceStep } from "@/lib/forms/types";

// P27: the `sequence` field: an ordered list of step ids built from a catalog (the pit scout's auto cycle). Rules, all pure:
//  - a step with `maxCount: 1` can appear once; `maxCount: 0` as often as wanted;
//  - a step pinned `first` is always at the start and a step pinned `last` always at the end, whatever order they were added in;
//  - only the middle steps (not pinned) can be moved; any step can be removed.

const byId = (catalog: readonly SequenceStep[]) => new Map(catalog.map((s) => [s.id, s]));

/**
 * A sequence cleaned against the catalog: unknown ids dropped, `maxCount: 1` steps kept once (the first occurrence), pinned-first steps moved to
 * the start and pinned-last steps to the end (each group keeping its own order), the middle keeping its order.
 */
export function normalizeSequence(catalog: readonly SequenceStep[], ids: readonly unknown[]): string[] {
  const steps = byId(catalog);
  const seenOnce = new Set<string>();
  const first: string[] = [];
  const middle: string[] = [];
  const last: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== "string") continue;
    const step = steps.get(raw);
    if (!step) continue;
    if (step.maxCount === 1) {
      if (seenOnce.has(step.id)) continue;
      seenOnce.add(step.id);
    }
    (step.pin === "first" ? first : step.pin === "last" ? last : middle).push(step.id);
  }
  return [...first, ...middle, ...last];
}

/** Can this step be added now (it exists, and a once-only step isn't already there)? */
export function canAddStep(catalog: readonly SequenceStep[], sequence: readonly string[], stepId: string): boolean {
  const step = byId(catalog).get(stepId);
  if (!step) return false;
  return step.maxCount === 0 || !sequence.includes(stepId);
}

/** Taps a step: it is appended (a pinned step lands at its end; a middle step goes before any pinned-last steps). Unchanged when it can't be added. */
export function addStep(catalog: readonly SequenceStep[], sequence: readonly string[], stepId: string): string[] {
  if (!canAddStep(catalog, sequence, stepId)) return [...sequence];
  return normalizeSequence(catalog, [...sequence, stepId]);
}

/** The indexes of the steps that can be moved (the middle ones). */
export function movableRange(catalog: readonly SequenceStep[], sequence: readonly string[]): { start: number; end: number } {
  const steps = byId(catalog);
  let start = 0;
  while (start < sequence.length && steps.get(sequence[start])?.pin === "first") start++;
  let end = sequence.length;
  while (end > start && steps.get(sequence[end - 1])?.pin === "last") end--;
  return { start, end }; // movable: start <= i < end
}

export const isMovable = (catalog: readonly SequenceStep[], sequence: readonly string[], index: number): boolean => {
  const { start, end } = movableRange(catalog, sequence);
  return index >= start && index < end;
};

/** Moves the step at `from` to `to` within the movable middle; anything else (a pinned step, an index outside the middle) leaves the sequence unchanged. */
export function moveStep(catalog: readonly SequenceStep[], sequence: readonly string[], from: number, to: number): string[] {
  const { start, end } = movableRange(catalog, sequence);
  if (from < start || from >= end) return [...sequence];
  const target = Math.max(start, Math.min(end - 1, Math.trunc(to)));
  if (target === from) return [...sequence];
  const next = [...sequence];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** Removes the step at `index`. */
export function removeStep(sequence: readonly string[], index: number): string[] {
  return sequence.filter((_, i) => i !== index);
}

/** "Start → Hive → Hive → Park": the labels in order (an id the catalog doesn't know shows as itself). */
export function summarizeSequence(catalog: readonly SequenceStep[], sequence: readonly string[], separator = " → "): string {
  const steps = byId(catalog);
  return sequence.map((id) => steps.get(id)?.shortLabel ?? steps.get(id)?.label ?? id).join(separator);
}

/** How many times each step appears (every catalog step present, zero included): what the analytics "count of each step" columns read. */
export function countSteps(catalog: readonly SequenceStep[], sequence: readonly string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const s of catalog) out[s.id] = 0;
  for (const id of sequence) if (id in out) out[id] += 1;
  return out;
}

/** Reads the summary text back into ids (for CSV import): labels split on the separator, matched case-insensitively; unknown labels are dropped. */
export function parseSequenceSummary(catalog: readonly SequenceStep[], text: string, separator = " → "): string[] {
  // either the short or the full label reads back to its step
  const byLabel = new Map(catalog.flatMap((s) => [[s.label.trim().toLowerCase(), s.id] as const, ...(s.shortLabel ? ([[s.shortLabel.trim().toLowerCase(), s.id]] as const) : [])]));
  const ids = text
    .split(separator.trim())
    .map((part) => byLabel.get(part.trim().toLowerCase()))
    .filter((id): id is string => !!id);
  return normalizeSequence(catalog, ids);
}
