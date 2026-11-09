import { repeatGroupOf, slotCountFor, slotKey } from "@/lib/forms/repeat";
import { summarizeSequence } from "@/lib/forms/sequence";
import type { CompareMatchOn, CompareWith, Form, FormField, FormValue, FormValues } from "@/lib/forms/types";

// P27: plan versus actual (`compareWith`). A Drive Reflection finds the Match Strategy entry for the same event / match / alliance, prefills
// from it (never over something the person already edited), and marks every answer that differs from the plan. Pure.

/** The minimum an entry says about itself to be matched as a plan. */
export type PlanCandidate = { id: string; formId: string; eventCode?: string | null; matchKey?: string | null; alliance?: string | null; createdAtMs?: number; values: FormValues };

export type PlanQuery = { eventCode?: string | null; matchKey?: string | null; alliance?: string | null };

/** The plan entry: of the entries of `compare.formId` that agree with the query on every `matchOn` part, the latest. Null while a part the match needs isn't chosen yet. */
export function findPlanEntry<T extends PlanCandidate>(entries: readonly T[], compare: Pick<CompareWith, "formId" | "matchOn">, query: PlanQuery): T | null {
  const wanted = (on: CompareMatchOn) => compare.matchOn.includes(on);
  if (wanted("eventCode") && !query.eventCode) return null;
  if (wanted("matchKey") && !query.matchKey) return null;
  if (wanted("alliance") && !query.alliance) return null;
  const matching = entries.filter(
    (e) => e.formId === compare.formId && (!wanted("eventCode") || e.eventCode === query.eventCode) && (!wanted("matchKey") || e.matchKey === query.matchKey) && (!wanted("alliance") || e.alliance === query.alliance)
  );
  // latest wins; entries without a time keep their given order (the later one in the list)
  return matching.reduce<T | null>((best, e) => (best === null || (e.createdAtMs ?? 0) >= (best.createdAtMs ?? 0) ? e : best), null);
}

/** One mapped pair: this form's storage key and the plan form's. Slot keys (`t1_role`) pair up slot for slot. */
export type KeyPair = { key: string; planKey: string };

/**
 * The map expanded to storage keys: a field in a repeating group maps per slot (`role` -> `t1_role`, `t2_role`, ... up to `slotCount`,
 * the plan's matching slot), anything else maps as written. A key that isn't a field of the form is dropped.
 */
export function expandFieldMap(form: Pick<Form, "sections">, fieldMap: Record<string, string>, slotCount: number): KeyPair[] {
  const pairs: KeyPair[] = [];
  for (const [key, planKey] of Object.entries(fieldMap)) {
    let placed = false;
    for (const section of form.sections) {
      for (const field of section.fields) {
        if (field.key !== key) continue;
        placed = true;
        const group = repeatGroupOf(section, field);
        if (group) for (let slot = 1; slot <= slotCountFor(slotCount, group.repeat.maxSlots); slot++) pairs.push({ key: slotKey(slot, key), planKey: slotKey(slot, planKey) });
        else pairs.push({ key, planKey });
      }
    }
    if (!placed && /^t[1-4]_/.test(key)) pairs.push({ key, planKey }); // an explicit slot key
  }
  return pairs;
}

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);

/** Do two stored values say the same thing? Empty equals empty (and an unticked box), numbers equal their text, lists and cell maps compare by content. */
export function sameValue(a: FormValue | undefined, b: FormValue | undefined): boolean {
  if (isEmpty(a) && isEmpty(b)) return true;
  if (typeof a === "boolean" || typeof b === "boolean") return (a === true) === (b === true);
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  if (typeof a === "object" || typeof b === "object") {
    const ka = Object.entries((a ?? {}) as Record<string, boolean>).filter(([, v]) => v);
    const kb = Object.entries((b ?? {}) as Record<string, boolean>).filter(([, v]) => v);
    return ka.length === kb.length && ka.every(([k]) => (b as Record<string, boolean> | undefined)?.[k] === true);
  }
  return String(a ?? "") === String(b ?? "");
}

export type PlanDifference = { key: string; planKey: string; planned: FormValue | undefined; actual: FormValue | undefined };

/** The mapped answers that differ from the plan. A key the plan never answered is not a difference (there is nothing to differ from). */
export function diffAgainstPlan(pairs: readonly KeyPair[], values: FormValues, planValues: FormValues): PlanDifference[] {
  const out: PlanDifference[] = [];
  for (const { key, planKey } of pairs) {
    if (!(planKey in planValues)) continue;
    if (!sameValue(values[key], planValues[planKey])) out.push({ key, planKey, planned: planValues[planKey], actual: values[key] });
  }
  return out;
}

/**
 * Values with the plan's answers copied in for every mapped key the person hasn't edited (`touched`). Called again when the plan changes, so an
 * untouched answer follows the plan live while an edited one stays the person's own. Returns `values` itself when nothing changes.
 */
export function prefillFromPlan(pairs: readonly KeyPair[], values: FormValues, planValues: FormValues, touched: ReadonlySet<string>): FormValues {
  let next: FormValues | null = null;
  for (const { key, planKey } of pairs) {
    if (touched.has(key) || !(planKey in planValues)) continue;
    if (sameValue(values[key], planValues[planKey])) continue;
    next ??= { ...values };
    next[key] = planValues[planKey];
  }
  return next ?? values;
}

/** "Planned: Hive": the plan's answer as a person reads it (an option's label, a ticked box as Yes, a sequence as its steps). */
export function plannedText(field: FormField | undefined, planned: FormValue | undefined): string {
  if (isEmpty(planned)) return "Planned: nothing";
  if (typeof planned === "boolean") return `Planned: ${planned ? "Yes" : "No"}`;
  if (field && (field.type === "select" || field.type === "radio")) return `Planned: ${field.options?.find((o) => o.value === planned)?.label ?? String(planned)}`;
  if (field?.type === "sequence" && Array.isArray(planned)) return `Planned: ${summarizeSequence(field.steps ?? [], planned as string[])}`;
  if (Array.isArray(planned)) return `Planned: ${planned.length} item${planned.length === 1 ? "" : "s"}`;
  if (typeof planned === "object") return `Planned: ${Object.keys(planned).filter((k) => (planned as Record<string, boolean>)[k]).length} checked`;
  return `Planned: ${String(planned)}`;
}

/** "2 differences from plan" / "1 difference from plan" / "Matches the plan". */
export function differenceSummary(count: number): string {
  return count === 0 ? "Matches the plan" : `${count} difference${count === 1 ? "" : "s"} from plan`;
}
