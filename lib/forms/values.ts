import { SYSTEM_FIELD_TYPES, type Form, type FormField, type FormValues, type FieldValue } from "@/lib/forms/types";
import { visibleFieldKeys } from "@/lib/forms/visibility";

// P21: building, cleaning and validating the values a form edits and an entry stores (keyed by field `key`).

const isSystem = (f: FormField): boolean => (SYSTEM_FIELD_TYPES as readonly string[]).includes(f.type);

/** Fields that hold a value (everything except the system pickers, which live on the entry itself: match, team, scout). */
export function valueFields(form: Pick<Form, "sections">): FormField[] {
  return form.sections.flatMap((s) => s.fields).filter((f) => !isSystem(f));
}

/** The starting value of one field: its own `default`, else a type default (counters their minimum or 0, toggles off, text empty). */
export function defaultFieldValue(field: FormField): FieldValue {
  if (field.default !== undefined) return field.default;
  switch (field.type) {
    case "toggle":
    case "checkbox":
      return false;
    case "counter":
      return field.min ?? 0;
    case "rating":
      return 0;
    case "number":
    case "select":
    case "radio":
    case "text":
    case "textarea":
    default:
      return "";
  }
}

export function defaultValues(form: Pick<Form, "sections">): FormValues {
  const values: FormValues = {};
  for (const f of valueFields(form)) values[f.key] = defaultFieldValue(f);
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

/** Re-keys values stored under old (renamed) keys to the current ones. A current key already present wins over an aliased old one. */
export function applyAliases(values: Record<string, unknown>, aliases: Form["keyAliases"]): Record<string, unknown> {
  if (!aliases || Object.keys(aliases).length === 0) return { ...values };
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(values)) {
    const target = resolveAlias(k, aliases);
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

/** One raw value coerced to the field's type: wrong-typed or out-of-range input becomes the field's default / the nearest valid value. */
export function coerceFieldValue(field: FormField, raw: unknown): FieldValue {
  switch (field.type) {
    case "toggle":
    case "checkbox":
      return raw === true || raw === "true" || raw === "Y";
    case "counter": {
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? clampNumber(field, n) : defaultFieldValue(field);
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
    case "select":
    case "radio":
      return (field.options ?? []).some((o) => o.value === raw) ? (raw as string) : defaultFieldValue(field);
    case "text":
    case "textarea":
      return typeof raw === "string" ? raw.slice(0, field.type === "text" ? 500 : 5000) : "";
    default:
      return defaultFieldValue(field);
  }
}

/**
 * Values cleaned for storage or scoring: aliases applied, every current field present and coerced, unknown keys dropped. Values
 * for hidden fields are kept (they're ignored by scoring and analytics) so toggling a condition off and on again doesn't lose input.
 */
export function normalizeValues(form: Pick<Form, "sections" | "keyAliases">, raw: Record<string, unknown>): FormValues {
  const aliased = applyAliases(raw, form.keyAliases);
  const out: FormValues = {};
  for (const f of valueFields(form)) out[f.key] = f.key in aliased ? coerceFieldValue(f, aliased[f.key]) : defaultFieldValue(f);
  return out;
}

/** Is this value "answered"? A toggle/checkbox always is; a counter always; numbers, text, choices and ratings need a non-empty value. */
export function isAnswered(field: FormField, value: unknown): boolean {
  switch (field.type) {
    case "toggle":
    case "checkbox":
    case "counter":
      return true;
    case "rating":
      return typeof value === "number" && value >= 1;
    case "number":
      return value !== "" && value !== undefined && value !== null && Number.isFinite(Number(value));
    default:
      return typeof value === "string" ? value.trim() !== "" : value !== undefined && value !== null;
  }
}

/**
 * Required-field validation, only for fields that are currently visible. A required toggle/checkbox must be **on** ("I confirm"),
 * which is the one meaningful reading of a required boolean. Returns `{ key: message }`, empty when the values are fine.
 */
export function validateValues(form: Pick<Form, "sections">, values: FormValues): Record<string, string> {
  const visible = visibleFieldKeys(form, values);
  const errors: Record<string, string> = {};
  for (const f of valueFields(form)) {
    if (!f.required || !visible.has(f.key)) continue;
    const v = values[f.key];
    if ((f.type === "toggle" || f.type === "checkbox") && v !== true) errors[f.key] = `${f.label} is required.`;
    else if (!isAnswered(f, v)) errors[f.key] = `${f.label} is required.`;
  }
  return errors;
}

/** The entry's summary comment: the first field tagged with the `comments` role. */
export function commentsFrom(form: Pick<Form, "sections">, values: FormValues): string {
  const field = form.sections.flatMap((s) => s.fields).find((f) => f.statRoles?.includes("comments"));
  return field && typeof values[field.key] === "string" ? (values[field.key] as string) : "";
}
