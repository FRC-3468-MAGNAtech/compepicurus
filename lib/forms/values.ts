import { normalizeSequence } from "@/lib/forms/sequence";
import { parseSlotKey, slotKey, valueSlots } from "@/lib/forms/repeat";
import { type Form, type FormField, type FormValues, type FormValue, type FieldValue, type ImageValue } from "@/lib/forms/types";
import { visibleFieldKeys } from "@/lib/forms/visibility";

// P21: building, cleaning and validating the values a form edits and an entry stores (keyed by field `key`).
// P27: slider, photos, sequences, matrices, and per-team repeating groups (stored by slot: `t1_notes`).

/** Fields that hold a value (everything except the system pickers, which live on the entry itself: event, match, alliance, team, scout). A team picker inside a repeating group holds each slot's team, so it is a value field. */
export function valueFields(form: Pick<Form, "sections">): FormField[] {
  return [...new Set(valueSlots(form).map((s) => s.field))];
}

/** The cells of a matrix that are offered: every row x column except the disabled ones, as `${rowKey}_${colKey}`. */
export function matrixCells(field: Pick<FormField, "rows" | "cols" | "disabledCells">): string[] {
  const disabled = new Set(field.disabledCells ?? []);
  const cells: string[] = [];
  for (const r of field.rows ?? []) for (const c of field.cols ?? []) if (!disabled.has(`${r.key}_${c.key}`)) cells.push(`${r.key}_${c.key}`);
  return cells;
}

/** The starting value of one field: its own `default`, else a type default (counters their minimum or 0, toggles off, text empty, lists empty). */
export function defaultFieldValue(field: FormField): FormValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "toggle":
    case "checkbox":
      return false;
    case "counter":
      return field.min ?? 0;
    case "slider":
      return field.min ?? 1;
    case "rating":
      return 0;
    case "image":
    case "sequence":
      return [];
    case "matrix":
      return Object.fromEntries(matrixCells(field).map((c) => [c, false]));
    case "number":
    case "select":
    case "radio":
    case "text":
    case "textarea":
    case "teamPicker":
    default:
      return "";
  }
}

export function defaultValues(form: Pick<Form, "sections">): FormValues {
  const values: FormValues = {};
  for (const s of valueSlots(form)) values[s.storageKey] = defaultFieldValue(s.field);
  return values;
}

/** Follows `keyAliases` (old key -> new key) transitively, so a value stored under a twice-renamed key still lands on the current one. */
export function resolveAlias(key: string, aliases: Form["keyAliases"]): string {
  let current = key;
  const seen = new Set<string>();
  while (aliases && aliases[current] && !seen.has(current)) {
    seen.add(current);
    current = aliases[current];
  }
  return current;
}

/** Re-keys values stored under old (renamed) keys to the current ones. A current key already present wins over an aliased old one. A slot key (`t1_old`) follows the alias of its field (`t1_new`). */
export function applyAliases(values: Record<string, unknown>, aliases: Form["keyAliases"]): Record<string, unknown> {
  if (!aliases || Object.keys(aliases).length === 0) return { ...values };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const slot = parseSlotKey(k);
    const target = slot && aliases[slot.key] ? slotKey(slot.slot, resolveAlias(slot.key, aliases)) : resolveAlias(k, aliases);
    if (target === k || !(target in values)) out[target] = v;
  }
  return out;
}

function clampNumber(field: FormField, raw: number): number {
  let n = raw;
  if (field.min !== undefined) n = Math.max(field.min, n);
  if (field.max !== undefined) n = Math.min(field.max, n);
  if (field.type === "counter") n = Math.round(n);
  else if (field.decimals !== undefined) n = Math.round(n * 10 ** field.decimals) / 10 ** field.decimals;
  return n;
}

const isHttps = (url: unknown): url is string => typeof url === "string" && url.length <= 600 && /^https:\/\/[^\s]+$/.test(url);

/** Photos cleaned: only well-formed entries with an https URL, at most `maxCount` (default 1). */
export function coerceImages(field: Pick<FormField, "maxCount">, raw: unknown): ImageValue[] {
  if (!Array.isArray(raw)) return [];
  const out: ImageValue[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    if (!isHttps(r.url)) continue;
    out.push({
      url: r.url,
      pathname: typeof r.pathname === "string" ? r.pathname.slice(0, 300) : "",
      size: typeof r.size === "number" && Number.isFinite(r.size) && r.size >= 0 ? r.size : 0,
      contentType: typeof r.contentType === "string" ? r.contentType.slice(0, 60) : "",
    });
  }
  return out.slice(0, field.maxCount ?? 1);
}

/** One raw value coerced to the field's type: wrong-typed or out-of-range input becomes the field's default / the nearest valid value. */
export function coerceFieldValue(field: FormField, raw: unknown): FormValue {
  switch (field.type) {
    case "toggle":
    case "checkbox":
      return raw === true || raw === "true" || raw === "Y";
    case "counter": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? clampNumber(field, n) : (defaultFieldValue(field) as FieldValue);
    }
    case "slider": {
      const n = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(n)) return defaultFieldValue(field);
      const min = field.min ?? 1;
      const max = field.max ?? 5;
      const step = field.step && field.step > 0 ? field.step : 1;
      // an integer on the step grid, inside the range
      const snapped = Math.round((Math.min(max, Math.max(min, n)) - min) / step) * step + min;
      return Math.min(max, Math.max(min, Math.round(snapped)));
    }
    case "rating": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? Math.min(field.scale ?? 5, Math.max(0, Math.round(n))) : 0;
    }
    case "number": {
      if (raw === "" || raw === null || raw === undefined) return "";
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? clampNumber(field, n) : "";
    }
    case "teamPicker": {
      if (raw === "" || raw === null || raw === undefined) return "";
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isInteger(n) && n > 0 ? n : "";
    }
    case "select":
    case "radio":
      return (field.options ?? []).some((o) => o.value === raw) ? (raw as string) : (defaultFieldValue(field) as FieldValue);
    case "text":
    case "textarea":
      return typeof raw === "string" ? raw.slice(0, field.type === "text" ? 500 : 5000) : "";
    case "image":
      return coerceImages(field, raw);
    case "sequence":
      return normalizeSequence(field.steps ?? [], Array.isArray(raw) ? raw : []);
    case "matrix": {
      const cells = matrixCells(field);
      const given = raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
      return Object.fromEntries(cells.map((c) => [c, given[c] === true]));
    }
    default:
      return defaultFieldValue(field);
  }
}

/**
 * Values cleaned for storage or scoring: aliases applied, every current field present and coerced (a repeating group's fields once per slot),
 * unknown keys dropped. Values for hidden fields are kept (they're ignored by scoring and analytics) so toggling a condition off and on
 * again doesn't lose input.
 */
export function normalizeValues(form: Pick<Form, "sections" | "keyAliases">, raw: Record<string, unknown>): FormValues {
  const aliased = applyAliases(raw, form.keyAliases);
  const out: FormValues = {};
  for (const s of valueSlots(form)) out[s.storageKey] = s.storageKey in aliased ? coerceFieldValue(s.field, aliased[s.storageKey]) : defaultFieldValue(s.field);
  return out;
}

/** Is this value "answered"? A toggle/checkbox always is; a counter and a slider always; numbers, text, choices and ratings need a non-empty value; photos, a sequence and a matrix need something in them. */
export function isAnswered(field: FormField, value: unknown): boolean {
  switch (field.type) {
    case "toggle":
    case "checkbox":
    case "counter":
    case "slider":
      return true;
    case "rating":
      return typeof value === "number" && value >= 1;
    case "number":
    case "teamPicker":
      return value !== "" && value !== undefined && value !== null && Number.isFinite(Number(value));
    case "image":
    case "sequence":
      return Array.isArray(value) && value.length > 0;
    case "matrix":
      return !!value && typeof value === "object" && Object.values(value as Record<string, boolean>).some((v) => v === true);
    default:
      return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
  }
}

/**
 * Required-field validation, only for fields that are currently visible. A required toggle/checkbox must be **on** ("I confirm"),
 * which is the one meaningful reading of a required boolean. A repeating group's fields are checked for the slots actually shown
 * (`slotCount`, default all). Returns `{ storageKey: message }`, empty when the values are fine.
 */
export function validateValues(form: Pick<Form, "sections">, values: FormValues, opts: { slotCount?: number } = {}): Record<string, string> {
  const visible = visibleFieldKeys(form, values);
  const errors: Record<string, string> = {};
  for (const s of valueSlots(form)) {
    const f = s.field;
    if (!f.required || !visible.has(f.key)) continue;
    if (s.slot !== null && opts.slotCount !== undefined && s.slot > opts.slotCount) continue;
    const v = values[s.storageKey];
    const name = s.slot === null ? f.label : `${f.label} (team ${s.slot})`;
    if ((f.type === "toggle" || f.type === "checkbox") && v !== true) errors[s.storageKey] = `${name} is required.`;
    else if (!isAnswered(f, v)) errors[s.storageKey] = `${name} is required.`;
  }
  return errors;
}

/** The entry's summary comment: the first field tagged with the `comments` role. */
export function commentsFrom(form: Pick<Form, "sections">, values: FormValues): string {
  const field = form.sections.flatMap((s) => s.fields).find((f) => f.statRoles?.includes("comments"));
  return field && typeof values[field.key] === "string" ? (values[field.key] as string) : "";
}

/** Sticky notes joined for a CSV cell, summary text and the legacy `comments` string: the notes' text separated by " | " (blank notes skipped). */
export function joinNotes(notes: readonly { text: string }[] | undefined): string {
  return (notes ?? [])
    .map((n) => n.text.trim())
    .filter(Boolean)
    .join(" | ");
}
