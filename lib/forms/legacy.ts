import type { Form, FormField, FormSection, FormValues, PhaseKey } from "@/lib/forms/types";
import { applyAliases } from "@/lib/forms/values";
import { systemFields } from "@/lib/forms/new-form";

// P21: the back-compat reader. Entries stored before schema v2 keep a typed `fields` object (BIOBUZZ's 15 keys) plus a top-level
// `comments`; entries written since carry `values` keyed by field `key`. Every consumer reads an entry through `entryValues()`, so
// both shapes load into the same value shape and nothing has to be migrated in Firestore (old documents are never rewritten).

/** The 15 keys the legacy `fields` object had: what the dual-write below keeps filling for BIOBUZZ entries, so a rollback or an old tab still reads new entries. */
export const LEGACY_FIELD_KEYS = [
  "autoLeave",
  "autoPark",
  "autoTipHive",
  "teleTipHive",
  "flowerBottomNectar",
  "flowerPollenNectar",
  "gardenPollenNectar",
  "endgamePark",
  "diedDuringMatch",
  "neverStartedMatch",
  "disabledByFtc",
  "recoveredFromFreeze",
  "tippedOver",
  "yellowCard",
  "redCard",
] as const;

/** The parts of an entry the reader needs (a stored ScoutEntry satisfies it, as does a fixture). */
export type EntryValueSource = { values?: Record<string, unknown> | null; fields?: Record<string, unknown> | null; comments?: string };

type Cached = { aliasKey: string; values: FormValues };
const cache = new WeakMap<object, Cached>();

function coerce(raw: Record<string, unknown>): FormValues {
  const out: FormValues = {};
  // P27: a value can also be a list (a sequence, photos) or a map of cells (a matrix); anything else (null, undefined, functions) is dropped
  for (const [k, v] of Object.entries(raw)) if (typeof v === "boolean" || typeof v === "number" || typeof v === "string" || (v !== null && typeof v === "object")) out[k] = v as FormValues[string];
  return out;
}

/**
 * An entry's values as `{ key: value }`, whichever shape it was stored in. New entries: `values`, with `keyAliases` applied so
 * a value stored under a since-renamed key reads under its current key. Pre-v2 entries: the legacy `fields` object plus
 * `comments`. Cached per entry object (cheap to call per table cell).
 */
export function entryValues(entry: EntryValueSource, form?: Pick<Form, "keyAliases"> | null): FormValues {
  const aliases = form?.keyAliases;
  const aliasKey = aliases ? JSON.stringify(aliases) : "";
  const hit = cache.get(entry);
  if (hit && hit.aliasKey === aliasKey) return hit.values;

  let values: FormValues;
  if (entry.values && typeof entry.values === "object") {
    values = coerce(applyAliases(entry.values, aliases));
  } else {
    values = coerce(applyAliases({ ...(entry.fields ?? {}), ...(typeof entry.comments === "string" ? { comments: entry.comments } : {}) }, aliases));
  }
  cache.set(entry, { aliasKey, values });
  return values;
}

const LEGACY_COUNTER_KEYS = new Set<string>(["autoTipHive", "teleTipHive", "flowerPollenNectar", "gardenPollenNectar"]);

/** The legacy `fields` object for a set of values (booleans and counters only, defaulting to off/0), for the BIOBUZZ dual-write. Matches the old `valuesToScoutEntryFields` exactly. */
export function legacyFieldsFromValues(values: FormValues): Record<string, boolean | number> {
  const out: Record<string, boolean | number> = {};
  for (const key of LEGACY_FIELD_KEYS) out[key] = LEGACY_COUNTER_KEYS.has(key) ? Number(values[key]) || 0 : Boolean(values[key]);
  return out;
}

/** True when a form still has every legacy key as a field, i.e. a BIOBUZZ lineage form whose entries a pre-v2 reader could also understand. */
export function hasLegacyShape(form: Pick<Form, "sections">): boolean {
  const keys = new Set(form.sections.flatMap((s) => s.fields.map((f) => f.key)));
  return LEGACY_FIELD_KEYS.every((k) => keys.has(k));
}

/** The pre-v2 form definition shape (flat `points`/`phase` on each field, groups that own their fields). Kept as a type only, for `fromLegacySchema`. */
export type LegacyField = {
  key: string;
  type: "toggle" | "counter" | "checkbox" | "pick" | "readonly" | "text";
  label: string;
  points?: number;
  phase?: "auto" | "teleop" | "endgame";
  element?: string;
  reliability?: boolean;
  placeholder?: string;
};
export type LegacySection = { id: string; label: string; fields?: LegacyField[]; groups?: { label: string; fields: LegacyField[] }[] };
export type LegacySchema = { id: string; version: number; name: string; sections: LegacySection[] };

const SECTION_PHASE: Record<string, PhaseKey> = { autonomous: "auto", auto: "auto", teleop: "teleop", teleoperated: "teleop", endgame: "endgame" };

function convertField(f: LegacyField, groupId?: string): FormField | null {
  if (f.type === "pick" || f.type === "readonly") return null; // never used by a real schema; there is no v2 equivalent
  const type = f.type === "text" ? "textarea" : f.type;
  const scored = !!f.points && !!f.phase;
  return {
    id: `f-${f.key}`,
    key: f.key,
    type,
    label: f.label,
    ...(groupId ? { groupId } : {}),
    ...(f.placeholder ? { placeholder: f.placeholder } : {}),
    ...(f.type === "counter" ? { min: 0, step: 1 } : {}),
    scoring: scored ? { mode: f.type === "counter" ? "perTally" : "whenOn", value: f.points } : { mode: "none" },
    analytics: { include: true, ...(f.element ? { element: f.element } : {}), aggregate: f.type === "counter" ? "avg" : f.type === "text" ? "list" : "rate" },
    ...(f.reliability ? { statRoles: ["reliability"] } : {}),
    ...(f.type === "text" && f.key === "comments" ? { statRoles: ["comments"] } : {}),
  };
}

/**
 * Upgrades a pre-v2 form definition to schema v2: a Pre-Match section with the locked system fields is added, each section's phase is
 * taken from its scored fields (or its id), groups become sub-groups, `points`/`phase` become a scoring rule, `reliability` and `element`
 * become a stat role and analytics metadata. Used to keep v1-shaped fixtures (and any form saved in the old shape) working.
 */
export function fromLegacySchema(schema: LegacySchema): Form {
  const sections: FormSection[] = [{ id: "pre-match", title: "Pre-Match", phase: "prematch", visible: true, fields: systemFields() }];
  for (const ls of schema.sections) {
    const flat = ls.fields ?? [];
    const groups = (ls.groups ?? []).map((g, i) => ({ id: `g${i}`, title: g.label }));
    const all = [...flat, ...(ls.groups ?? []).flatMap((g) => g.fields)];
    const phase = all.find((f) => f.points && f.phase)?.phase ?? SECTION_PHASE[ls.id] ?? SECTION_PHASE[ls.label.toLowerCase()] ?? "misc";
    const fields = [
      ...flat.map((f) => convertField(f)),
      ...(ls.groups ?? []).flatMap((g, i) => g.fields.map((f) => convertField(f, `g${i}`))),
    ].filter((f): f is FormField => f !== null);
    sections.push({ id: ls.id, title: ls.label, phase, visible: true, ...(groups.length > 0 ? { groups } : {}), fields });
  }
  return {
    id: schema.id,
    name: schema.name,
    description: "",
    formType: "match-scout",
    tags: [],
    version: schema.version,
    status: "published",
    scoringEnabled: true,
    sections,
    origin: "custom",
    createdBy: "legacy",
  };
}
