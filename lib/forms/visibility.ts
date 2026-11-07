import type { Form, FormField, FormValues, VisibleWhen } from "@/lib/forms/types";

/** Does a simple condition hold against the current values? Missing values read as "not checked / zero / empty". */
export function conditionHolds(when: VisibleWhen, values: FormValues): boolean {
  const v = values[when.fieldKey];
  switch (when.op) {
    case "checked":
      return v === true;
    case "equals":
      // a number typed into a text-ish value, or an option value, compares as written
      return typeof when.value === "boolean" ? v === when.value : String(v ?? "") === String(when.value);
    case "gt":
      return typeof v === "number" ? v > when.value : typeof v === "string" && v.trim() !== "" && Number(v) > when.value;
  }
}

/**
 * The keys of the fields that are currently visible: the category is visible, and the field's own condition holds
 * **and** the field it waits on is itself visible (a chain of conditions can't show a field whose parent is hidden).
 * Order-independent, and a circular chain (which `checkForm` reports) is simply hidden rather than looping.
 */
export function visibleFieldKeys(form: Pick<Form, "sections">, values: FormValues): Set<string> {
  const all = new Map<string, { field: FormField; sectionVisible: boolean }>();
  for (const s of form.sections) for (const f of s.fields) all.set(f.key, { field: f, sectionVisible: s.visible });

  const memo = new Map<string, boolean>();
  const resolve = (key: string, trail: Set<string>): boolean => {
    const known = memo.get(key);
    if (known !== undefined) return known;
    const entry = all.get(key);
    if (!entry || !entry.sectionVisible) return false;
    if (trail.has(key)) return false; // a cycle
    const when = entry.field.visibleWhen;
    let result = true;
    if (when) {
      trail.add(key);
      result = resolve(when.fieldKey, trail) && conditionHolds(when, values);
      trail.delete(key);
    }
    memo.set(key, result);
    return result;
  };

  const visible = new Set<string>();
  for (const key of all.keys()) if (resolve(key, new Set())) visible.add(key);
  return visible;
}

export function isFieldVisible(form: Pick<Form, "sections">, values: FormValues, key: string): boolean {
  return visibleFieldKeys(form, values).has(key);
}
