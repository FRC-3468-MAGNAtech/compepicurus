import { z } from "zod";
import {
  STANDARD_PHASES,
  STAT_ROLES,
  SYSTEM_FIELD_TYPES,
  USER_FIELD_TYPES,
  type Form,
  type FormField,
  type FormSection,
} from "@/lib/forms/types";

// P21: the zod validator for schema v2 (structure, types, sizes) and `checkForm` (the semantic rules the builder
// shows as blocking errors and warnings). `parseForm` is what imports and Firestore reads go through, so a form is
// never trusted just because it came from storage or a file.

export const FORM_LIMITS = {
  sections: 24,
  fieldsPerForm: 300,
  fieldsPerSection: 80,
  groupsPerSection: 12,
  options: 50,
  tags: 10,
  name: 80,
  label: 80,
  description: 500,
  helpText: 300,
  tip: 300,
  placeholder: 120,
  optionLabel: 80,
  keyAliases: 200,
  /** A form's JSON, so an import can be refused before it is parsed. */
  jsonBytes: 512 * 1024,
} as const;

const ID = /^[A-Za-z0-9_-]{1,40}$/;
const KEY = /^[A-Za-z][A-Za-z0-9_]{0,39}$/;
const PHASE = /^[a-z][a-z0-9_-]{0,23}$/;
/** No control, bidi or zero-width characters in any text a form carries. */
const CLEAN = /^[^\u0000-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]*$/;

const text = (max: number) => z.string().max(max).regex(CLEAN, "contains control characters");
const label = z.string().trim().min(1).max(FORM_LIMITS.label).regex(CLEAN, "contains control characters");
const finite = z.number().finite();

const visibleWhen = z.discriminatedUnion("op", [
  z.object({ fieldKey: z.string().regex(KEY), op: z.literal("checked") }).strict(),
  z.object({ fieldKey: z.string().regex(KEY), op: z.literal("equals"), value: z.union([z.string().max(80), finite, z.boolean()]) }).strict(),
  z.object({ fieldKey: z.string().regex(KEY), op: z.literal("gt"), value: finite }).strict(),
]);

const colorToken = z.enum(["default", "primary", "secondary", "accent", "success", "warning", "danger"]);

const fieldSchema = z
  .object({
    id: z.string().regex(ID),
    key: z.string().regex(KEY),
    type: z.enum([...USER_FIELD_TYPES, ...SYSTEM_FIELD_TYPES]),
    label,
    helpText: text(FORM_LIMITS.helpText).optional(),
    required: z.boolean().optional(),
    default: z.union([z.string().max(500), finite, z.boolean()]).optional(),
    visibleWhen: visibleWhen.optional(),
    groupId: z.string().regex(ID).optional(),
    ui: z
      .object({
        size: z.enum(["sm", "md", "lg"]).optional(),
        icon: z.string().regex(/^[a-z0-9-]{1,40}$/).optional(),
        color: colorToken.optional(),
        width: z.enum(["full", "half"]).optional(),
      })
      .strict()
      .optional(),
    placeholder: text(FORM_LIMITS.placeholder).optional(),
    min: finite.optional(),
    max: finite.optional(),
    step: finite.optional(),
    decimals: z.number().int().min(0).max(6).optional(),
    options: z
      .array(z.object({ value: z.string().min(1).max(60).regex(CLEAN), label: z.string().min(1).max(FORM_LIMITS.optionLabel).regex(CLEAN), points: finite.optional() }).strict())
      .max(FORM_LIMITS.options)
      .optional(),
    scale: z.number().int().min(2).max(10).optional(),
    scoring: z.object({ mode: z.enum(["none", "whenOn", "perTally", "perUnit", "byOption"]), value: finite.optional(), cap: finite.optional() }).strict().optional(),
    analytics: z
      .object({
        include: z.boolean(),
        label: text(FORM_LIMITS.label).optional(),
        category: text(FORM_LIMITS.label).optional(),
        aggregate: z.enum(["sum", "avg", "rate", "last", "list"]).optional(),
        csvHeader: text(160).optional(),
        element: text(FORM_LIMITS.label).optional(),
      })
      .strict()
      .optional(),
    statRoles: z.array(z.enum(STAT_ROLES)).max(STAT_ROLES.length).optional(),
    unrealisticAbove: finite.optional(),
    tip: text(FORM_LIMITS.tip).optional(),
  })
  .strict();

const sectionSchema = z
  .object({
    id: z.string().regex(ID),
    title: label,
    phase: z.string().regex(PHASE),
    groups: z.array(z.object({ id: z.string().regex(ID), title: label }).strict()).max(FORM_LIMITS.groupsPerSection).optional(),
    fields: z.array(fieldSchema).max(FORM_LIMITS.fieldsPerSection),
    visible: z.boolean(),
    accent: colorToken.optional(),
  })
  .strict();

export const formSchema = z
  .object({
    id: z.string().regex(ID),
    name: z.string().trim().min(1).max(FORM_LIMITS.name).regex(CLEAN),
    description: text(FORM_LIMITS.description),
    formType: z.literal("match-scout"),
    tags: z.array(z.string().min(1).max(30).regex(CLEAN)).max(FORM_LIMITS.tags),
    version: z.number().int().min(0),
    status: z.enum(["draft", "published"]),
    scoringEnabled: z.boolean(),
    sections: z.array(sectionSchema).max(FORM_LIMITS.sections),
    origin: z.enum(["built-in", "built-in-override", "custom", "template"]),
    baseBuiltInId: z.string().regex(ID).optional(),
    baseBuiltInHash: z.string().max(64).optional(),
    templateId: z.string().regex(ID).optional(),
    templateVersion: z.number().int().min(0).optional(),
    keyAliases: z.record(z.string().regex(KEY), z.string().regex(KEY)).optional(),
    phaseLabels: z.record(z.string().regex(PHASE), z.string().min(1).max(FORM_LIMITS.label).regex(CLEAN)).optional(),
    createdBy: z.string().max(128),
    createdAt: finite.optional(),
    updatedAt: finite.optional(),
  })
  .strict();

export type ParseIssue = { path: string; message: string };

/** Structural validation: types, sizes, unknown keys and unknown field types are all rejected. Returns the parsed form (a copy), or every issue. */
export function parseForm(input: unknown): { ok: true; form: Form } | { ok: false; issues: ParseIssue[] } {
  const result = formSchema.safeParse(input);
  if (result.success) return { ok: true, form: result.data as Form };
  return { ok: false, issues: result.error.issues.slice(0, 50).map((i) => ({ path: i.path.join("."), message: i.message })) };
}

// --- semantic checks ---------------------------------------------------------------------------

export type FormIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  /** The field or section the issue is about (for the builder to select). */
  fieldId?: string;
  sectionId?: string;
};

const isSystem = (t: string): boolean => (SYSTEM_FIELD_TYPES as readonly string[]).includes(t);
const NUMERIC = new Set(["counter", "number", "rating"]);
const BOOLEAN = new Set(["toggle", "checkbox"]);
const CHOICE = new Set(["select", "radio"]);

/** Which scoring modes make sense for a field type. */
export function scoringModesFor(type: FormField["type"]): readonly string[] {
  switch (type) {
    case "toggle":
    case "checkbox":
      return ["none", "whenOn"];
    case "counter":
      return ["none", "perTally"];
    case "number":
    case "rating":
      return ["none", "perUnit"];
    case "select":
    case "radio":
      return ["none", "byOption"];
    default:
      return ["none"];
  }
}

export function allFormFields(form: Pick<Form, "sections">): FormField[] {
  return form.sections.flatMap((s) => s.fields);
}

/**
 * The semantic rules on top of the structure: the builder's blocking errors and warnings (P22), and what keeps a
 * published form from being nonsense. Pure and deterministic.
 */
export function checkForm(form: Form): FormIssue[] {
  const issues: FormIssue[] = [];
  const err = (code: string, message: string, f?: { id?: string; sectionId?: string }) => issues.push({ severity: "error", code, message, fieldId: f?.id, sectionId: f?.sectionId });
  const warn = (code: string, message: string, f?: { id?: string; sectionId?: string }) => issues.push({ severity: "warning", code, message, fieldId: f?.id, sectionId: f?.sectionId });

  const fields = allFormFields(form);
  if (fields.length > FORM_LIMITS.fieldsPerForm) err("too-many-fields", `A form can have at most ${FORM_LIMITS.fieldsPerForm} fields.`);

  // ids and keys are unique
  const seenKeys = new Map<string, FormField>();
  const seenIds = new Set<string>();
  const seenSections = new Set<string>();
  for (const s of form.sections) {
    if (seenSections.has(s.id)) err("duplicate-section-id", `Two categories share the id "${s.id}".`, { sectionId: s.id });
    seenSections.add(s.id);
    if (!s.title.trim()) err("empty-section-title", "A category has no title.", { sectionId: s.id });
    const groupIds = new Set((s.groups ?? []).map((g) => g.id));
    if (groupIds.size !== (s.groups ?? []).length) err("duplicate-group-id", `"${s.title}" has two groups with the same id.`, { sectionId: s.id });
    if (s.fields.length > 25) warn("long-section", `"${s.title}" has ${s.fields.length} fields: that's a long scroll one-handed. Consider splitting it.`, { sectionId: s.id });
    for (const f of s.fields) {
      if (f.groupId && !groupIds.has(f.groupId)) err("unknown-group", `"${f.label}" is in a group that doesn't exist in "${s.title}".`, { id: f.id, sectionId: s.id });
    }
  }
  for (const f of fields) {
    if (seenIds.has(f.id)) err("duplicate-id", `Two fields share the id "${f.id}".`, { id: f.id });
    seenIds.add(f.id);
    const prior = seenKeys.get(f.key);
    if (prior) err("duplicate-key", `The data key "${f.key}" is used by both "${prior.label}" and "${f.label}". Keys must be unique.`, { id: f.id });
    else seenKeys.set(f.key, f);
    if (!f.label.trim()) err("empty-label", "A field has no label.", { id: f.id });
  }

  // system fields: required for match-scout forms, locked in Pre-Match
  for (const type of SYSTEM_FIELD_TYPES) {
    const found = form.sections.flatMap((s) => s.fields.map((f) => ({ f, s }))).filter(({ f }) => f.type === type);
    if (found.length === 0) err("missing-system-field", `The ${type === "matchPicker" ? "match picker" : type === "teamPicker" ? "team picker" : "scout name"} is required.`);
    else if (found.length > 1) err("duplicate-system-field", `There can be only one ${type}.`, { id: found[1].f.id });
    for (const { f, s } of found) {
      if (s.phase !== "prematch") err("system-field-phase", `The ${f.label} must stay in a Pre-Match category.`, { id: f.id, sectionId: s.id });
      if (f.required === false) err("system-field-required", `The ${f.label} is always required.`, { id: f.id });
    }
  }

  // phases
  for (const s of form.sections) {
    if (!(STANDARD_PHASES as readonly string[]).includes(s.phase) && !form.phaseLabels?.[s.phase]) {
      warn("unlabelled-phase", `"${s.title}" uses the custom phase "${s.phase}" with no label. Its key will be shown.`, { sectionId: s.id });
    }
  }

  // per-field rules
  const byKey = new Map(fields.map((f) => [f.key, f]));
  let scoringFields = 0;
  for (const f of fields) {
    const ctx = { id: f.id };
    if (f.scoring && f.scoring.mode !== "none") {
      scoringFields++;
      if (!scoringModesFor(f.type).includes(f.scoring.mode)) err("scoring-mode", `"${f.label}": a ${f.type} can't score "${f.scoring.mode}".`, ctx);
      if (f.scoring.mode !== "byOption" && !Number.isFinite(f.scoring.value)) err("scoring-value", `"${f.label}" scores points but has no point value.`, ctx);
      if (f.scoring.mode === "byOption" && !(f.options ?? []).some((o) => typeof o.points === "number")) err("scoring-options", `"${f.label}" scores by option but none of its options has points.`, ctx);
      if (f.scoring.cap !== undefined && f.scoring.cap < 0) err("scoring-cap", `"${f.label}": the points cap can't be negative.`, ctx);
    }
    if (f.type === "counter") {
      if (f.step !== undefined && f.step <= 0) err("counter-step", `"${f.label}": the step must be greater than 0.`, ctx);
      if (f.min !== undefined && f.max !== undefined && f.min > f.max) err("counter-range", `"${f.label}": the minimum is above the maximum.`, ctx);
    }
    if (f.type === "number" && f.min !== undefined && f.max !== undefined && f.min > f.max) err("number-range", `"${f.label}": the minimum is above the maximum.`, ctx);
    if (CHOICE.has(f.type)) {
      const opts = f.options ?? [];
      if (opts.length < 2) err("options-count", `"${f.label}" needs at least two options.`, ctx);
      if (new Set(opts.map((o) => o.value)).size !== opts.length) err("options-duplicate", `"${f.label}" has two options with the same value.`, ctx);
    }
    if (f.type === "rating" && (f.scale === undefined || f.scale < 2)) err("rating-scale", `"${f.label}" needs a rating scale of at least 2.`, ctx);
    if (isSystem(f.type) && f.visibleWhen) err("system-field-condition", `The ${f.label} can't be conditional.`, ctx);
    if (f.required && f.visibleWhen) warn("required-conditional", `"${f.label}" is required but only sometimes shown. It's only required while it's visible.`, ctx);
    // hard to use one-handed: many tiny choices, a long star row, or a long list squeezed into tiles
    if (f.type === "radio" && (f.options?.length ?? 0) > 6) warn("hard-one-handed", `"${f.label}" shows ${f.options!.length} choices as tiles. More than 6 is hard to tap one-handed: use a dropdown instead.`, ctx);
    if (f.type === "select" && (f.options?.length ?? 0) > 12) warn("hard-one-handed", `"${f.label}" has ${f.options!.length} options in a dropdown. A long list is slow to scroll one-handed: consider fewer.`, ctx);
    if (f.type === "rating" && (f.scale ?? 5) > 7) warn("hard-one-handed", `"${f.label}" is a ${f.scale}-star rating. More than 7 targets in a row are too small to hit reliably.`, ctx);
    if (f.type === "number" && f.min === undefined && f.max === undefined && f.scoring?.mode === "perUnit") warn("unbounded-number", `"${f.label}" scores per unit with no maximum: a typo like 500 would score 500 times over. Set a maximum or a points cap.`, ctx);
    if (f.ui?.size === "sm" && (f.type === "counter" || f.type === "toggle")) warn("small-target", `"${f.label}" is a small touch target. Big targets are easier one-handed.`, ctx);
    if (f.statRoles?.some((r) => r !== "primaryScoring" && r !== "comments") && !BOOLEAN.has(f.type)) err("stat-role-type", `"${f.label}": incident roles (reliability, died, ...) need a toggle or checkbox.`, ctx);
    if (f.statRoles?.includes("comments") && f.type !== "text" && f.type !== "textarea") err("stat-role-comments", `"${f.label}": the comments role needs a text or comments field.`, ctx);
  }
  if (form.scoringEnabled && scoringFields === 0) err("scoring-empty", "Scoring is on, but no field scores any points.");

  // conditions: must reference a real, other field, be satisfiable, and not form a cycle
  const deps = new Map<string, string>();
  for (const f of fields) {
    const w = f.visibleWhen;
    if (!w) continue;
    const target = byKey.get(w.fieldKey);
    if (!target) {
      err("condition-missing", `"${f.label}" is shown depending on a field that doesn't exist ("${w.fieldKey}").`, { id: f.id });
      continue;
    }
    if (target.key === f.key) {
      err("condition-self", `"${f.label}" can't depend on itself.`, { id: f.id });
      continue;
    }
    deps.set(f.key, target.key);
    if (w.op === "checked" && !BOOLEAN.has(target.type)) err("condition-unreachable", `"${f.label}" waits for "${target.label}" to be checked, but that isn't a toggle or checkbox, so it would never show.`, { id: f.id });
    if (w.op === "gt" && !NUMERIC.has(target.type)) err("condition-unreachable", `"${f.label}" waits for "${target.label}" to be above a number, but that isn't a numeric field, so it would never show.`, { id: f.id });
    if (w.op === "equals" && CHOICE.has(target.type) && !(target.options ?? []).some((o) => o.value === String(w.value))) {
      err("condition-unreachable", `"${f.label}" waits for "${target.label}" to equal "${String(w.value)}", which isn't one of its options, so it would never show.`, { id: f.id });
    }
  }
  for (const start of deps.keys()) {
    const seen = new Set<string>([start]);
    for (let cur = deps.get(start); cur !== undefined; cur = deps.get(cur)) {
      if (seen.has(cur)) {
        const f = byKey.get(start)!;
        err("condition-cycle", `"${f.label}" is part of a circular chain of conditions, so none of it can ever show.`, { id: f.id });
        break;
      }
      seen.add(cur);
    }
  }

  // aliases must point at a key that exists (and not at themselves)
  for (const [from, to] of Object.entries(form.keyAliases ?? {})) {
    if (from === to) err("alias-self", `The alias "${from}" points at itself.`);
    else if (!byKey.has(to)) err("alias-target", `The alias "${from}" points at "${to}", which isn't a field key.`);
    else if (byKey.has(from)) err("alias-shadow", `The old key "${from}" is also a current key, so it can't be an alias.`);
  }
  return issues;
}

export const blockingIssues = (issues: FormIssue[]): FormIssue[] => issues.filter((i) => i.severity === "error");
export const sectionById = (form: Form, id: string): FormSection | undefined => form.sections.find((s) => s.id === id);
