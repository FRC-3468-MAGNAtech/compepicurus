import type { CompareWith, FieldType, Form, FormField, FormGroup, FormSection, FormType, GroupRepeat, PhaseKey, StickyNotesConfig, SystemFieldType, UserFieldType, VisibleWhen } from "@/lib/forms/types";
import { systemFieldsFor } from "@/lib/forms/new-form";
import { isSystemField as isSystemFieldBase } from "@/lib/forms/types";
import { FORM_LIMITS, scoringModesFor } from "@/lib/forms/validate";

// P22: the pure editing operations behind the Form Builder. Every function takes a Form and returns a new Form (never mutates), so the
// builder's undo/redo history is just a stack of forms, and every operation is unit-tested without a UI. Nothing here knows a game.
// Rules these keep: ids are unique and never reused; keys are unique and never collide with an alias; the three system fields can be
// moved within Pre-Match but never deleted, retyped or duplicated; renaming the key of a field that was ever published leaves an alias.

export const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;

export const isSystemField = (f: Pick<FormField, "type" | "key">): boolean => isSystemFieldBase(f);

// --- ids and keys ----------------------------------------------------------------------------------------------

export function allIds(form: Form): Set<string> {
  const ids = new Set<string>();
  for (const s of form.sections) {
    ids.add(s.id);
    for (const g of s.groups ?? []) ids.add(g.id);
    for (const f of s.fields) ids.add(f.id);
  }
  return ids;
}

/** A fresh id (`prefix-xxxxxx`) that isn't in `taken`. `rand` is injectable so tests are deterministic. */
export function newId(prefix: string, taken: ReadonlySet<string>, rand: () => number = Math.random): string {
  for (let i = 0; i < 1000; i++) {
    const id = `${prefix}-${Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0")}`;
    if (!taken.has(id)) return id;
  }
  return `${prefix}-${taken.size}-${Date.now().toString(36)}`;
}

/** "Auto Park (full)" -> "autoParkFull": camelCase, ASCII letters and digits, starts with a letter, at most 36 characters. */
export function keyFromLabel(label: string): string {
  const words = label
    .normalize("NFKD")
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  let key = words.map((w, i) => (i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1))).join("");
  if (!key || !/^[A-Za-z]/.test(key)) key = `field${key.charAt(0).toUpperCase()}${key.slice(1)}`;
  return key.slice(0, 36);
}

/** Every key a new field must avoid: the current keys (except the field being edited) and both ends of every alias. */
function reservedKeys(form: Form, exceptFieldId?: string): Set<string> {
  const keys = new Set<string>();
  for (const s of form.sections) for (const f of s.fields) if (f.id !== exceptFieldId) keys.add(f.key);
  for (const [from, to] of Object.entries(form.keyAliases ?? {})) {
    keys.add(from);
    keys.add(to);
  }
  return keys;
}

/** `base`, or `base2`, `base3`… so it collides with nothing. */
export function uniqueKey(form: Form, base: string, exceptFieldId?: string): string {
  const clean = KEY_PATTERN.test(base) ? base : keyFromLabel(base);
  const taken = reservedKeys(form, exceptFieldId);
  if (!taken.has(clean)) return clean;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${clean.slice(0, 36)}${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${clean.slice(0, 30)}${Date.now() % 1_000_000}`;
}

/** Why `key` can't be used for this field right now, or null when it can. */
export function keyProblem(form: Form, fieldId: string, key: string): string | null {
  if (!KEY_PATTERN.test(key)) return "Use letters, digits and underscores, starting with a letter (40 characters at most).";
  const clash = form.sections.flatMap((s) => s.fields).find((f) => f.id !== fieldId && f.key === key);
  if (clash) return `"${clash.label}" already uses that key.`;
  const aliases = form.keyAliases ?? {};
  if (Object.prototype.hasOwnProperty.call(aliases, key)) {
    // renaming a field *back* to a key it used to have (an alias whose chain ends at this field) is fine: the alias is then dropped
    const current = form.sections.flatMap((s) => s.fields).find((f) => f.id === fieldId);
    if (!current || resolveTo(aliases, key) !== current.key) return "That key is an old name of another field.";
  }
  return null;
}

function resolveTo(aliases: Record<string, string>, key: string): string {
  let cur = key;
  for (let i = 0; i < 20 && cur in aliases; i++) cur = aliases[cur];
  return cur;
}

// --- locating things --------------------------------------------------------------------------------------------

export function findField(form: Form, fieldId: string): { section: FormSection; field: FormField; index: number } | null {
  for (const section of form.sections) {
    const index = section.fields.findIndex((f) => f.id === fieldId);
    if (index >= 0) return { section, field: section.fields[index], index };
  }
  return null;
}

export const findSection = (form: Form, sectionId: string): FormSection | undefined => form.sections.find((s) => s.id === sectionId);

/** A section's fields as laid out on screen: the ungrouped ones, then each group's, each in order. Storage order is normalised to this on every edit. */
export type SectionLayout = { ungrouped: FormField[]; groups: { group: FormGroup; fields: FormField[] }[] };

export function layoutOf(section: FormSection): SectionLayout {
  const groups = section.groups ?? [];
  const ids = new Set(groups.map((g) => g.id));
  return {
    ungrouped: section.fields.filter((f) => !f.groupId || !ids.has(f.groupId)),
    groups: groups.map((group) => ({ group, fields: section.fields.filter((f) => f.groupId === group.id) })),
  };
}

const flatten = (layout: SectionLayout): FormField[] => [...layout.ungrouped, ...layout.groups.flatMap((g) => g.fields)];

function withSection(form: Form, sectionId: string, fn: (s: FormSection) => FormSection): Form {
  return { ...form, sections: form.sections.map((s) => (s.id === sectionId ? fn(s) : s)) };
}

function mapFields(form: Form, fn: (f: FormField, s: FormSection) => FormField): Form {
  return { ...form, sections: form.sections.map((s) => ({ ...s, fields: s.fields.map((f) => fn(f, s)) })) };
}

// --- new fields -------------------------------------------------------------------------------------------------

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  toggle: "Toggle",
  counter: "Counter",
  checkbox: "Checkbox",
  number: "Number",
  text: "Text",
  textarea: "Comments",
  select: "Dropdown",
  radio: "Pick one",
  rating: "Rating",
  slider: "Slider",
  image: "Photos",
  sequence: "Step sequence",
  matrix: "Checkbox grid",
  matchPicker: "Match picker",
  teamPicker: "Team picker",
  scoutName: "Scout name",
  eventPicker: "Event picker",
  alliancePicker: "Alliance picker",
};

/** A new field of `type` with sensible defaults: nothing scores until the author turns scoring on; it's in analytics with the aggregate that fits its type. */
export function defaultField(form: Form, type: UserFieldType, label?: string, rand?: () => number): FormField {
  const text = label?.trim() || `New ${FIELD_TYPE_LABEL[type].toLowerCase()}`;
  const base: FormField = {
    id: newId("f", allIds(form), rand),
    key: uniqueKey(form, keyFromLabel(text)),
    type,
    label: text,
    scoring: { mode: "none" },
    analytics: { include: true, aggregate: type === "counter" || type === "number" || type === "rating" || type === "slider" ? "avg" : type === "text" || type === "textarea" || type === "image" ? "list" : type === "select" || type === "radio" || type === "sequence" ? "last" : "rate" },
  };
  switch (type) {
    case "slider":
      return { ...base, min: 1, max: 5, step: 1, ticks: true, endLabels: { min: "Low", max: "High" } };
    case "image":
      return { ...base, maxCount: 1, capture: true };
    case "sequence":
      return {
        ...base,
        steps: [
          { id: "start", label: "Start", maxCount: 1, pin: "first" },
          { id: "step1", label: "Step 1", maxCount: 0, pin: null },
          { id: "end", label: "End", maxCount: 1, pin: "last" },
        ],
      };
    case "matrix":
      return {
        ...base,
        rows: [
          { key: "row1", label: "Row 1" },
          { key: "row2", label: "Row 2" },
        ],
        cols: [
          { key: "col1", label: "Column 1" },
          { key: "col2", label: "Column 2" },
        ],
        disabledCells: [],
      };
    case "counter":
      return { ...base, min: 0, step: 1 };
    case "number":
      return { ...base, decimals: 0 };
    case "rating":
      return { ...base, scale: 5 };
    case "select":
    case "radio":
      return {
        ...base,
        options: [
          { value: "option1", label: "Option 1" },
          { value: "option2", label: "Option 2" },
        ],
      };
    default:
      return base;
  }
}

// --- fields -------------------------------------------------------------------------------------------------------

/** Adds a field to a section (and group), at `index` among that container's fields (default: the end). System fields can't be added. */
export function addField(form: Form, sectionId: string, field: FormField, at: { index?: number; groupId?: string } = {}): Form {
  if (isSystemField(field)) return form;
  const section = findSection(form, sectionId);
  if (!section || form.sections.flatMap((s) => s.fields).length >= FORM_LIMITS.fieldsPerForm || section.fields.length >= FORM_LIMITS.fieldsPerSection) return form;
  const groupId = at.groupId && section.groups?.some((g) => g.id === at.groupId) ? at.groupId : undefined;
  return withSection(form, sectionId, (s) => {
    const layout = layoutOf(s);
    const placed: FormField = groupId ? { ...field, groupId } : stripGroup(field);
    const list = groupId ? layout.groups.find((g) => g.group.id === groupId)!.fields : layout.ungrouped;
    list.splice(clamp(at.index ?? list.length, 0, list.length), 0, placed);
    return { ...s, fields: flatten(layout) };
  });
}

const stripGroup = (f: FormField): FormField => {
  if (f.groupId === undefined) return f;
  const rest = { ...f };
  delete rest.groupId;
  return rest;
};

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/** Deletes a field. System fields stay. Fields that were shown depending on it lose that condition (a dangling condition would hide them forever). */
export function removeField(form: Form, fieldId: string): Form {
  const hit = findField(form, fieldId);
  if (!hit || isSystemField(hit.field)) return form;
  const key = hit.field.key;
  const next: Form = { ...form, sections: form.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== fieldId) })) };
  return mapFields(next, (f) => (f.visibleWhen?.fieldKey === key ? dropCondition(f) : f));
}

const dropCondition = (f: FormField): FormField => {
  const rest = { ...f };
  delete rest.visibleWhen;
  return rest;
};

export type MoveTarget = { sectionId: string; groupId?: string; index: number };

/** Moves a field to a container of any section. System fields may only move within Pre-Match (and stay out of groups). */
export function moveField(form: Form, fieldId: string, target: MoveTarget): Form {
  const hit = findField(form, fieldId);
  const dest = findSection(form, target.sectionId);
  if (!hit || !dest) return form;
  if (isSystemField(hit.field) && (dest.phase !== "prematch" || target.groupId)) return form;
  if (!isSystemField(hit.field) && dest.fields.filter((f) => f.id !== fieldId).length >= FORM_LIMITS.fieldsPerSection) return form;
  const removed: Form = { ...form, sections: form.sections.map((s) => ({ ...s, fields: s.fields.filter((f) => f.id !== fieldId) })) };
  return addMoved(removed, target, hit.field);
}

function addMoved(form: Form, target: MoveTarget, field: FormField): Form {
  const section = findSection(form, target.sectionId)!;
  const groupId = target.groupId && section.groups?.some((g) => g.id === target.groupId) ? target.groupId : undefined;
  return withSection(form, target.sectionId, (s) => {
    const layout = layoutOf(s);
    const list = groupId ? layout.groups.find((g) => g.group.id === groupId)!.fields : layout.ungrouped;
    list.splice(clamp(target.index, 0, list.length), 0, groupId ? { ...field, groupId } : stripGroup(field));
    return { ...s, fields: flatten(layout) };
  });
}

/** Up/down for touch and keyboard: one step within the field's container, then across into the neighbouring category. */
export function moveFieldBy(form: Form, fieldId: string, delta: -1 | 1): Form {
  const hit = findField(form, fieldId);
  if (!hit) return form;
  const layout = layoutOf(hit.section);
  const container = hit.field.groupId && layout.groups.some((g) => g.group.id === hit.field.groupId) ? layout.groups.find((g) => g.group.id === hit.field.groupId)!.fields : layout.ungrouped;
  const at = container.findIndex((f) => f.id === fieldId);
  const to = at + delta;
  if (to >= 0 && to < container.length) {
    return moveField(form, fieldId, { sectionId: hit.section.id, groupId: container === layout.ungrouped ? undefined : hit.field.groupId, index: to });
  }
  const si = form.sections.findIndex((s) => s.id === hit.section.id);
  const neighbour = form.sections[si + delta];
  if (!neighbour) return form;
  if (isSystemField(hit.field) && neighbour.phase !== "prematch") return form;
  const nLayout = layoutOf(neighbour);
  return moveField(form, fieldId, { sectionId: neighbour.id, index: delta < 0 ? nLayout.ungrouped.length : 0 });
}

/** A copy right after the original: new id, a unique key, "(copy)" on the label. System fields can't be duplicated. */
export function duplicateField(form: Form, fieldId: string, rand?: () => number): { form: Form; id: string | null } {
  const hit = findField(form, fieldId);
  if (!hit || isSystemField(hit.field)) return { form, id: null };
  const copy: FormField = {
    ...structuredCloneField(hit.field),
    id: newId("f", allIds(form), rand),
    key: uniqueKey(form, `${hit.field.key}Copy`),
    label: `${hit.field.label} (copy)`.slice(0, FORM_LIMITS.label),
  };
  delete copy.statRoles; // roles (reliability, died...) describe one incident: a copy would double-count it
  const layout = layoutOf(hit.section);
  const container = hit.field.groupId && layout.groups.some((g) => g.group.id === hit.field.groupId) ? layout.groups.find((g) => g.group.id === hit.field.groupId)!.fields : layout.ungrouped;
  const next = addField(form, hit.section.id, copy, { groupId: container === layout.ungrouped ? undefined : hit.field.groupId, index: container.findIndex((f) => f.id === fieldId) + 1 });
  return { form: next, id: next === form ? null : copy.id };
}

const structuredCloneField = (f: FormField): FormField => JSON.parse(JSON.stringify(f)) as FormField;

/** Patches a field (an object merged in, or a function). A patched `key` should go through `setFieldKey` so conditions and aliases follow. */
export function updateField(form: Form, fieldId: string, patch: Partial<FormField> | ((f: FormField) => FormField)): Form {
  return mapFields(form, (f) => {
    if (f.id !== fieldId) return f;
    const next = typeof patch === "function" ? patch(f) : { ...f, ...patch };
    // a system field's identity is locked
    return isSystemField(f) ? { ...next, id: f.id, key: f.key, type: f.type, required: true, visibleWhen: undefined } : next;
  });
}

/** Same change to several fields at once (bulk edit); system fields are skipped. */
export function updateFields(form: Form, fieldIds: readonly string[], fn: (f: FormField) => FormField): Form {
  const ids = new Set(fieldIds);
  return mapFields(form, (f) => (ids.has(f.id) && !isSystemField(f) ? fn(f) : f));
}

/**
 * Changes a field's data key. Conditions that pointed at the old key follow it. If the old key was ever published (`publishedKeys`),
 * an alias old -> new is recorded so entries stored under the old key still read under the new one; chains are collapsed, and
 * renaming back to an old key removes the alias. Returns the form unchanged when the key isn't usable (see `keyProblem`).
 */
export function setFieldKey(form: Form, fieldId: string, newKey: string, publishedKeys: ReadonlySet<string> = new Set()): Form {
  const hit = findField(form, fieldId);
  if (!hit || isSystemField(hit.field) || hit.field.key === newKey || keyProblem(form, fieldId, newKey)) return form;
  const old = hit.field.key;
  let aliases: Record<string, string> = { ...(form.keyAliases ?? {}) };
  delete aliases[newKey];
  for (const [from, to] of Object.entries(aliases)) if (to === old) aliases[from] = newKey;
  if (publishedKeys.has(old)) aliases[old] = newKey;
  aliases = Object.fromEntries(Object.entries(aliases).filter(([from, to]) => from !== to));
  const renamed = mapFields(form, (f) => {
    if (f.id === fieldId) return { ...f, key: newKey };
    return f.visibleWhen?.fieldKey === old ? { ...f, visibleWhen: { ...f.visibleWhen, fieldKey: newKey } as VisibleWhen } : f;
  });
  const next: Form = { ...renamed };
  if (Object.keys(aliases).length > 0) next.keyAliases = aliases;
  else delete next.keyAliases;
  return next;
}

// --- categories (sections) ----------------------------------------------------------------------------------------

export function addSection(form: Form, input: { title?: string; phase?: PhaseKey } = {}, rand?: () => number): { form: Form; id: string | null } {
  if (form.sections.length >= FORM_LIMITS.sections) return { form, id: null };
  const section: FormSection = { id: newId("s", allIds(form), rand), title: input.title?.trim() || "New category", phase: input.phase ?? "misc", visible: true, fields: [] };
  return { form: { ...form, sections: [...form.sections, section] }, id: section.id };
}

export function updateSection(form: Form, sectionId: string, patch: Partial<Pick<FormSection, "title" | "phase" | "visible" | "accent">>): Form {
  const next = withSection(form, sectionId, (s) => ({ ...s, ...patch }));
  const section = findSection(next, sectionId);
  // moving a section with the system fields out of Pre-Match would break the form: keep them in Pre-Match
  if (section && section.phase !== "prematch" && section.fields.some(isSystemField)) return form;
  return next;
}

/** Deletes a category and its fields. A category holding a system field can't be deleted. Conditions on removed fields are dropped. */
export function removeSection(form: Form, sectionId: string): Form {
  const section = findSection(form, sectionId);
  if (!section || section.fields.some(isSystemField)) return form;
  const gone = new Set(section.fields.map((f) => f.key));
  const next: Form = { ...form, sections: form.sections.filter((s) => s.id !== sectionId) };
  return mapFields(next, (f) => (f.visibleWhen && gone.has(f.visibleWhen.fieldKey) ? dropCondition(f) : f));
}

export function moveSectionBy(form: Form, sectionId: string, delta: -1 | 1): Form {
  const i = form.sections.findIndex((s) => s.id === sectionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= form.sections.length) return form;
  const sections = [...form.sections];
  [sections[i], sections[j]] = [sections[j], sections[i]];
  return { ...form, sections };
}

/** Reorders by dragging: moves the category to `index`. */
export function moveSectionTo(form: Form, sectionId: string, index: number): Form {
  const i = form.sections.findIndex((s) => s.id === sectionId);
  if (i < 0) return form;
  const sections = [...form.sections];
  const [moved] = sections.splice(i, 1);
  sections.splice(clamp(index, 0, sections.length), 0, moved);
  return { ...form, sections };
}

/** A copy right after the original, with fresh ids and unique keys. System fields aren't copied (there is only one of each). */
export function duplicateSection(form: Form, sectionId: string, rand?: () => number): { form: Form; id: string | null } {
  const section = findSection(form, sectionId);
  if (!section || form.sections.length >= FORM_LIMITS.sections) return { form, id: null };
  const taken = allIds(form);
  const id = newId("s", taken, rand);
  taken.add(id);
  const groupMap = new Map<string, string>();
  const groups = section.groups?.map((g) => {
    const gid = newId("g", taken, rand);
    taken.add(gid);
    groupMap.set(g.id, gid);
    return { ...g, id: gid };
  });
  const scratch: Form = form;
  const { fields } = cloneFields(scratch, section.fields.filter((f) => !isSystemField(f)), { groupMap, taken, rand });
  const copy: FormSection = { ...section, id, title: `${section.title} (copy)`.slice(0, FORM_LIMITS.label), groups, fields };
  if (!groups) delete copy.groups;
  const i = form.sections.findIndex((s) => s.id === sectionId);
  const sections = [...form.sections];
  sections.splice(i + 1, 0, copy);
  return { form: { ...form, sections }, id };
}

// --- groups (H2 headings inside a category) -----------------------------------------------------------------------

export function addGroup(form: Form, sectionId: string, title = "New group", rand?: () => number): { form: Form; id: string | null } {
  const section = findSection(form, sectionId);
  if (!section || (section.groups?.length ?? 0) >= FORM_LIMITS.groupsPerSection) return { form, id: null };
  const id = newId("g", allIds(form), rand);
  return { form: withSection(form, sectionId, (s) => ({ ...s, groups: [...(s.groups ?? []), { id, title: title.trim() || "New group" }] })), id };
}

export function updateGroup(form: Form, sectionId: string, groupId: string, title: string): Form {
  return withSection(form, sectionId, (s) => ({ ...s, groups: s.groups?.map((g) => (g.id === groupId ? { ...g, title } : g)) }));
}

/** Deletes a group heading; its fields stay in the category, ungrouped. */
export function removeGroup(form: Form, sectionId: string, groupId: string): Form {
  return withSection(form, sectionId, (s) => {
    const groups = s.groups?.filter((g) => g.id !== groupId);
    const next: FormSection = { ...s, groups, fields: s.fields.map((f) => (f.groupId === groupId ? stripGroup(f) : f)) };
    if (!groups || groups.length === 0) delete next.groups;
    return next;
  });
}

export function moveGroupBy(form: Form, sectionId: string, groupId: string, delta: -1 | 1): Form {
  return withSection(form, sectionId, (s) => {
    const groups = [...(s.groups ?? [])];
    const i = groups.findIndex((g) => g.id === groupId);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= groups.length) return s;
    [groups[i], groups[j]] = [groups[j], groups[i]];
    const next = { ...s, groups };
    return { ...next, fields: flatten(layoutOf(next)) };
  });
}

// --- cloning (Insert from BIOBUZZ, duplicate section) ------------------------------------------------------------

/**
 * Copies fields with fresh ids and keys that are unique in `form` (and among themselves). A condition that points at another copied
 * field follows that field's new key; one that points at a field that wasn't copied is dropped (it would dangle). System fields are skipped.
 */
export function cloneFields(
  form: Form,
  fields: readonly FormField[],
  opts: { groupMap?: ReadonlyMap<string, string>; forceGroupId?: string; taken?: Set<string>; rand?: () => number } = {}
): { fields: FormField[]; keyMap: Map<string, string> } {
  const taken = opts.taken ?? allIds(form);
  const scratch: Form = { ...form, sections: form.sections.map((s) => ({ ...s, fields: [...s.fields] })) };
  const keyMap = new Map<string, string>();
  const out: FormField[] = [];
  for (const source of fields.filter((f) => !isSystemField(f))) {
    const id = newId("f", taken, opts.rand);
    taken.add(id);
    const key = uniqueKey(scratch, source.key);
    keyMap.set(source.key, key);
    const clone: FormField = { ...structuredCloneField(source), id, key };
    // reserve the key for the next one (scratch gets a placeholder field so uniqueKey sees it)
    if (scratch.sections.length > 0) scratch.sections[0] = { ...scratch.sections[0], fields: [...scratch.sections[0].fields, { id, key, type: "text", label: "x" }] };
    if (opts.forceGroupId) clone.groupId = opts.forceGroupId;
    else if (clone.groupId) {
      const mapped = opts.groupMap?.get(clone.groupId);
      if (mapped) clone.groupId = mapped;
      else delete clone.groupId;
    }
    out.push(clone);
  }
  for (const f of out) {
    if (!f.visibleWhen) continue;
    const to = keyMap.get(f.visibleWhen.fieldKey);
    if (to) f.visibleWhen = { ...f.visibleWhen, fieldKey: to } as VisibleWhen;
    else delete f.visibleWhen;
  }
  return { fields: out, keyMap };
}

export type SourceRef = { kind: "section"; sectionId: string } | { kind: "group"; sectionId: string; groupId: string } | { kind: "field"; fieldId: string };

/**
 * "Insert from BIOBUZZ" (or any other form): clones a category, a group, or one field, with its point values, into `form`.
 * A category becomes a new category at the end; a group becomes a new group in `targetSectionId`; a field is added to `targetSectionId`.
 */
export function insertFromForm(form: Form, source: Form, ref: SourceRef, targetSectionId?: string, rand?: () => number): { form: Form; id: string | null } {
  if (ref.kind === "section") {
    const section = findSection(source, ref.sectionId);
    if (!section || form.sections.length >= FORM_LIMITS.sections) return { form, id: null };
    const taken = allIds(form);
    const id = newId("s", taken, rand);
    taken.add(id);
    const groupMap = new Map<string, string>();
    const groups = section.groups?.map((g) => {
      const gid = newId("g", taken, rand);
      taken.add(gid);
      groupMap.set(g.id, gid);
      return { ...g, id: gid };
    });
    const { fields } = cloneFields(form, section.fields, { groupMap, taken, rand });
    const copy: FormSection = { id, title: section.title, phase: section.phase === "prematch" ? "misc" : section.phase, visible: true, fields, ...(groups ? { groups } : {}), ...(section.accent ? { accent: section.accent } : {}) };
    return { form: { ...form, sections: [...form.sections, copy] }, id };
  }
  const target = targetSectionId ? findSection(form, targetSectionId) : undefined;
  if (!target) return { form, id: null };
  if (ref.kind === "group") {
    const src = findSection(source, ref.sectionId);
    const group = src?.groups?.find((g) => g.id === ref.groupId);
    if (!src || !group) return { form, id: null };
    const added = addGroup(form, target.id, group.title, rand);
    if (!added.id) return { form, id: null };
    const { fields } = cloneFields(added.form, src.fields.filter((f) => f.groupId === group.id), { forceGroupId: added.id, rand });
    let next = added.form;
    for (const f of fields) next = addField(next, target.id, f, { groupId: added.id });
    return { form: next, id: added.id };
  }
  const hit = findField(source, ref.fieldId);
  if (!hit || isSystemField(hit.field)) return { form, id: null };
  const { fields } = cloneFields(form, [hit.field], { rand });
  const clone = fields[0];
  delete clone.groupId;
  delete clone.visibleWhen; // a lone field has nothing to depend on
  const next = addField(form, target.id, clone);
  return { form: next, id: next === form ? null : clone.id };
}

// --- form-level -----------------------------------------------------------------------------------------------------

export function setPhaseLabel(form: Form, phase: PhaseKey, label: string): Form {
  const labels = { ...(form.phaseLabels ?? {}) };
  if (label.trim()) labels[phase] = label.trim().slice(0, FORM_LIMITS.label);
  else delete labels[phase];
  const next: Form = { ...form, phaseLabels: labels };
  if (Object.keys(labels).length === 0) delete next.phaseLabels;
  return next;
}

/** A phase key for a new custom phase named `name` ("Pit Stop" -> "pit-stop"), unique among the form's. */
export function phaseKeyFromName(form: Form, name: string): string {
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").replace(/^[^a-z]+/, "").slice(0, 20) || "custom";
  const taken = new Set(form.sections.map((s) => s.phase));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  return `${base}-${Date.now() % 1000}`;
}

/** Every key that has appeared in any published version of a form, for `setFieldKey`'s alias rule. */
export function keysOf(forms: readonly Pick<Form, "sections">[]): Set<string> {
  const keys = new Set<string>();
  for (const f of forms) for (const s of f.sections) for (const field of s.fields) keys.add(field.key);
  return keys;
}

// --- changing a field's type -------------------------------------------------------------------------------------------

const NUMERIC_TYPES = new Set<FieldType>(["counter", "number", "rating"]);
const BOOLEAN_TYPES = new Set<FieldType>(["toggle", "checkbox"]);
const CHOICE_TYPES = new Set<FieldType>(["select", "radio"]);
const TEXT_TYPES = new Set<FieldType>(["text", "textarea"]);

/**
 * Turns a field into another type, keeping what still makes sense (label, key, help, tip, required, condition, group, look, analytics
 * label/category, a points rule that fits the new type) and dropping what doesn't (a counter's range on a toggle, options on a number…).
 * The stat roles that need a toggle go when the new type isn't one. System fields can't be retyped.
 */
export function changeFieldType(form: Form, fieldId: string, type: UserFieldType): Form {
  return updateField(form, fieldId, (f) => {
    if (f.type === type) return f;
    const fresh = defaultField({ ...form, sections: [] }, type, f.label);
    const keepRule = f.scoring && f.scoring.mode !== "none" && scoringModesFor(type).includes(f.scoring.mode);
    const roles = f.statRoles?.filter((r) => (r === "primaryScoring" ? true : r === "comments" ? TEXT_TYPES.has(type) : BOOLEAN_TYPES.has(type)));
    const next: FormField = {
      id: f.id,
      key: f.key,
      type,
      label: f.label,
      ...(f.helpText ? { helpText: f.helpText } : {}),
      ...(f.tip ? { tip: f.tip } : {}),
      ...(f.required ? { required: true } : {}),
      ...(f.visibleWhen ? { visibleWhen: f.visibleWhen } : {}),
      ...(f.groupId ? { groupId: f.groupId } : {}),
      ...(f.ui ? { ui: f.ui } : {}),
      ...(roles && roles.length > 0 ? { statRoles: roles } : {}),
      scoring: keepRule ? f.scoring : { mode: "none" },
      analytics: { ...fresh.analytics!, include: f.analytics?.include ?? true, ...(f.analytics?.label ? { label: f.analytics.label } : {}), ...(f.analytics?.category ? { category: f.analytics.category } : {}), ...(f.analytics?.element ? { element: f.analytics.element } : {}) },
    };
    if (type === "counter") Object.assign(next, { min: 0, step: 1 });
    if (type === "number") Object.assign(next, { decimals: 0 });
    if (type === "rating") Object.assign(next, { scale: 5 });
    // P27: a slider, photos, a sequence and a grid start from their own defaults (nothing carries over from the old type)
    if (type === "slider" || type === "image" || type === "sequence" || type === "matrix") {
      const { min, max, step, ticks, endLabels, maxCount, capture, steps, rows, cols, disabledCells } = fresh;
      Object.assign(next, JSON.parse(JSON.stringify({ min, max, step, ticks, endLabels, maxCount, capture, steps, rows, cols, disabledCells })));
    }
    if (CHOICE_TYPES.has(type)) next.options = f.options && f.options.length >= 2 ? f.options : fresh.options;
    if (NUMERIC_TYPES.has(type) && f.unrealisticAbove !== undefined && NUMERIC_TYPES.has(f.type)) next.unrealisticAbove = f.unrealisticAbove;
    if (TEXT_TYPES.has(type) && f.placeholder) next.placeholder = f.placeholder;
    return next;
  });
}

// --- repairing a file with duplicate ids or keys (P23 import) ----------------------------------------------------------------

/**
 * Makes ids and keys unique without touching anything else: the first use of an id or key keeps it, later duplicates get fresh ones (keys keep their
 * text with a number after it). Conditions keep pointing at the first field with that key. Used by "Fix automatically" in the import preview, so a
 * template with a copy-paste slip imports instead of being refused. Returns what it changed, in words.
 */
export function repairDuplicates(form: Form, rand?: () => number): { form: Form; fixes: string[] } {
  const fixes: string[] = [];
  const taken = allIds(form);
  const seenSection = new Set<string>();
  const seenField = new Set<string>();
  const seenKey = new Set<string>();
  const reserved = new Set<string>();
  for (const [from, to] of Object.entries(form.keyAliases ?? {})) {
    reserved.add(from);
    reserved.add(to);
  }
  const fresh = (prefix: string): string => {
    const id = newId(prefix, taken, rand);
    taken.add(id);
    return id;
  };
  const sections = form.sections.map((s) => {
    let id = s.id;
    if (seenSection.has(id)) {
      id = fresh("s");
      fixes.push(`Two categories shared an id: "${s.title}" got a new one.`);
    }
    seenSection.add(id);
    const groupSeen = new Set<string>();
    const groupMap = new Map<string, string>();
    const groups = s.groups?.map((g) => {
      if (!groupSeen.has(g.id)) {
        groupSeen.add(g.id);
        return g;
      }
      const gid = fresh("g");
      fixes.push(`Two groups in "${s.title}" shared an id: "${g.title}" got a new one.`);
      groupMap.set(g.id, gid);
      return { ...g, id: gid };
    });
    const fields = s.fields.map((f) => {
      let next = f;
      if (seenField.has(f.id)) {
        next = { ...next, id: fresh("f") };
        fixes.push(`Two fields shared an id: "${f.label}" got a new one.`);
      }
      seenField.add(next.id);
      if (seenKey.has(next.key)) {
        let n = 2;
        const base = next.key.slice(0, 36);
        while (seenKey.has(`${base}${n}`) || reserved.has(`${base}${n}`)) n++;
        fixes.push(`Two fields used the key "${next.key}": "${next.label}" is now "${base}${n}".`);
        next = { ...next, key: `${base}${n}` };
      }
      seenKey.add(next.key);
      return next;
    });
    return { ...s, id, ...(groups ? { groups } : {}), fields };
  });
  return { form: fixes.length > 0 ? { ...form, sections } : form, fixes };
}

// --- P27: per-team groups, sticky notes, plan comparison, form type ---------------------------------------------------------

/** Turns a group into a per-team repeating group (one box per team of the chosen alliance, up to `maxSlots`), or back into a plain one with `null`. */
export function setGroupRepeat(form: Form, sectionId: string, groupId: string, repeat: GroupRepeat | null): Form {
  return withSection(form, sectionId, (s) => ({
    ...s,
    groups: s.groups?.map((g) => {
      if (g.id !== groupId) return g;
      const { repeat: _old, ...rest } = g;
      void _old;
      return repeat ? { ...rest, repeat: { source: repeat.source, maxSlots: clamp(Math.trunc(repeat.maxSlots), 1, FORM_LIMITS.repeatSlots) } } : rest;
    }),
  }));
}

/** The sticky notes panel setting; \`null\` removes it. */
export function setFormStickyNotes(form: Form, config: StickyNotesConfig | null): Form {
  const { stickyNotes: _old, ...rest } = form;
  void _old;
  return config ? { ...rest, stickyNotes: { enabled: config.enabled, defaultOpen: config.enabled && config.defaultOpen } } : rest;
}

/** The plan-versus-actual setting; \`null\` removes it. */
export function setFormCompareWith(form: Form, config: CompareWith | null): Form {
  const { compareWith: _old, ...rest } = form;
  void _old;
  return config ? { ...rest, compareWith: config } : rest;
}

/**
 * Changes what the form is for. The system fields the new type requires are added to the first Pre-Match category (an existing one is kept, and an extra
 * one the new type doesn't need stays: the builder places those freely). Scoring is turned off for a non-scoring type only when nothing scores.
 */
export function setFormType(form: Form, formType: FormType): Form {
  if (form.formType === formType) return form;
  const have = new Set(form.sections.flatMap((s) => s.fields).filter(isSystemField).map((f) => f.type));
  const missing = systemFieldsFor(formType).filter((f) => !have.has(f.type as SystemFieldType));
  const target = form.sections.find((s) => s.phase === "prematch") ?? form.sections[0];
  let next: Form = { ...form, formType };
  if (target && missing.length > 0) {
    const taken = new Set(next.sections.flatMap((s) => s.fields).map((f) => f.id));
    next = withSection(next, target.id, (s) => ({ ...s, fields: [...missing.filter((f) => !taken.has(f.id)), ...s.fields] }));
  }
  return next;
}

/** A new team picker for inside a per-team group (not the match's own team picker, which is a locked system field): a normal, deletable field that holds that slot's team and can be changed. */
export function defaultTeamPicker(form: Form, label = "Team", rand?: () => number): FormField {
  return {
    id: newId("f", allIds(form), rand),
    key: uniqueKey(form, keyFromLabel(label) === "teamNumber" ? "team" : keyFromLabel(label)),
    type: "teamPicker",
    label,
    scoring: { mode: "none" },
    analytics: { include: true, aggregate: "last" },
  };
}

/** The system pickers (event, match, alliance, team, scout) a form doesn't have yet: what the builder offers to place. */
export function missingSystemFields(form: Form): FormField[] {
  const have = new Set(form.sections.flatMap((s) => s.fields).filter(isSystemField).map((f) => f.type));
  return (["eventPicker", "matchPicker", "alliancePicker", "teamPicker", "scoutName"] as const)
    .filter((t) => !have.has(t))
    .flatMap((t) => systemFieldsFor("lead-scout").concat(systemFieldsFor("pit-scout")).concat(systemFieldsFor("match-scout")).filter((f) => f.type === t).slice(0, 1));
}

/** Places a missing system picker in the first Pre-Match category (where the locked fields live). A picker the form already has is not added twice. */
export function addSystemField(form: Form, type: SystemFieldType): Form {
  const field = missingSystemFields(form).find((f) => f.type === type);
  const target = form.sections.find((s) => s.phase === "prematch");
  if (!field || !target) return form;
  return withSection(form, target.id, (s) => ({ ...s, fields: [...s.fields, field] }));
}
