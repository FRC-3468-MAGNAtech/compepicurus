import { canonicalJson } from "@/lib/forms/hash";
import type { Form, FormField, FormSection, ScoringRule } from "@/lib/forms/types";

// P22: what changed between two versions of a form, for the version-history diff, "View changes from built-in", and the publish
// confirmation. Fields are matched by their stable `id` (so a rename is a change, not a remove + add). Each change says whether it
// "affects scores" (existing entries would score differently if rescored) and/or "affects data" (a column, key or value shape changed).

export type ChangeKind = "added" | "removed" | "changed" | "moved";
export type Impact = { scores: boolean; data: boolean };

export type FieldChange = { id: string; label: string; key: string; section: string; kind: ChangeKind; details: string[]; impact: Impact };
export type SectionChange = { id: string; title: string; kind: ChangeKind; details: string[]; impact: Impact };

export type FormDiff = {
  /** Form-level changes (name, description, tags, scoring on/off, aliases, phase labels). */
  form: string[];
  sections: SectionChange[];
  fields: FieldChange[];
  impact: Impact;
  empty: boolean;
  counts: { added: number; removed: number; changed: number };
};

const NONE: Impact = { scores: false, data: false };
/** Deep equality that ignores key order (a form that went through the validator or Firestore has its keys in another order) and undefined fields. */
const same = (a: unknown, b: unknown): boolean => canonicalJson(a ?? null) === canonicalJson(b ?? null);
const isScoring = (f: Pick<FormField, "scoring">): boolean => !!f.scoring && f.scoring.mode !== "none";
const or = (a: Impact, b: Impact): Impact => ({ scores: a.scores || b.scores, data: a.data || b.data });

/** A short human description of a scoring rule ("3 pts each", "no points"). */
export function describeScoring(rule: ScoringRule | undefined): string {
  if (!rule || rule.mode === "none") return "no points";
  const cap = rule.cap !== undefined ? ` (max ${rule.cap})` : "";
  switch (rule.mode) {
    case "whenOn":
      return `${rule.value ?? 0} pts when on${cap}`;
    case "perTally":
      return `${rule.value ?? 0} pts each${cap}`;
    case "perUnit":
      return `${rule.value ?? 0} pts per unit${cap}`;
    case "byOption":
      return `points by option${cap}`;
  }
}

const q = (s: string): string => `"${s}"`;

function diffField(before: FormField, after: FormField, beforeSection: FormSection, afterSection: FormSection, afterForm: Form): FieldChange | null {
  const details: string[] = [];
  let impact: Impact = { ...NONE };
  const scoring = isScoring(before) || isScoring(after);

  if (before.label !== after.label) details.push(`Label ${q(before.label)} → ${q(after.label)}`);
  if (before.key !== after.key) {
    const aliased = afterForm.keyAliases?.[before.key] === after.key;
    details.push(`Data key ${q(before.key)} → ${q(after.key)}${aliased ? " (old entries still read under the new key)" : " (old entries will NOT read under the new key)"}`);
    impact = or(impact, { scores: scoring && !aliased, data: true });
  }
  if (before.type !== after.type) {
    details.push(`Type ${before.type} → ${after.type}`);
    impact = or(impact, { scores: scoring, data: true });
  }
  if (!same(before.scoring, after.scoring)) {
    details.push(`Points: ${describeScoring(before.scoring)} → ${describeScoring(after.scoring)}`);
    impact = or(impact, { scores: true, data: false });
  }
  if (!same(before.options, after.options)) {
    const bv = new Map((before.options ?? []).map((o) => [o.value, o]));
    const av = new Map((after.options ?? []).map((o) => [o.value, o]));
    const removed = [...bv.keys()].filter((v) => !av.has(v));
    const added = [...av.keys()].filter((v) => !bv.has(v));
    const repointed = [...av.keys()].filter((v) => bv.has(v) && bv.get(v)!.points !== av.get(v)!.points);
    const relabelled = [...av.keys()].filter((v) => bv.has(v) && bv.get(v)!.label !== av.get(v)!.label);
    if (added.length) details.push(`Options added: ${added.join(", ")}`);
    if (removed.length) details.push(`Options removed: ${removed.join(", ")}`);
    if (repointed.length) details.push(`Option points changed: ${repointed.join(", ")}`);
    if (relabelled.length) details.push(`Option labels changed: ${relabelled.join(", ")}`);
    if (added.length + removed.length + repointed.length + relabelled.length === 0) details.push("Options reordered");
    impact = or(impact, { scores: repointed.length > 0 || (scoring && removed.length > 0), data: removed.length > 0 || added.length > 0 });
  }
  for (const k of ["min", "max", "step", "decimals", "scale"] as const) {
    if (before[k] !== after[k]) {
      details.push(`${k[0].toUpperCase()}${k.slice(1)} ${before[k] ?? "—"} → ${after[k] ?? "—"}`);
      impact = or(impact, { scores: scoring && k !== "step", data: k === "scale" || k === "decimals" });
    }
  }
  if (!same(before.visibleWhen, after.visibleWhen)) {
    details.push(before.visibleWhen && after.visibleWhen ? "Visibility condition changed" : after.visibleWhen ? "Visibility condition added" : "Visibility condition removed");
    impact = or(impact, { scores: scoring, data: false });
  }
  if (!!before.required !== !!after.required) details.push(after.required ? "Now required" : "No longer required");
  if (!same(before.default, after.default)) details.push("Default value changed");
  if ((before.helpText ?? "") !== (after.helpText ?? "")) details.push("Help text changed");
  if ((before.tip ?? "") !== (after.tip ?? "")) details.push("Scouting tip changed");
  if ((before.placeholder ?? "") !== (after.placeholder ?? "")) details.push("Placeholder changed");
  if (!same(before.ui, after.ui)) details.push("Look (size, icon, colour, width) changed");
  if (!same(before.analytics, after.analytics)) details.push("Analytics settings changed");
  if (!same(before.statRoles, after.statRoles)) details.push("Stat roles changed (flags and stats read these)");
  if (before.unrealisticAbove !== after.unrealisticAbove) details.push(`"Unrealistic above" ${before.unrealisticAbove ?? "—"} → ${after.unrealisticAbove ?? "—"}`);

  let kind: ChangeKind = "changed";
  if (beforeSection.id !== afterSection.id) {
    details.push(`Moved from ${q(beforeSection.title)} to ${q(afterSection.title)}`);
    kind = details.length === 1 ? "moved" : "changed";
    impact = or(impact, { scores: scoring && beforeSection.phase !== afterSection.phase, data: false });
  } else if ((beforeSection.groups?.find((g) => g.id === before.groupId)?.title ?? "") !== (afterSection.groups?.find((g) => g.id === after.groupId)?.title ?? "")) {
    details.push("Moved to a different group");
  }
  if (details.length === 0) return null;
  return { id: after.id, label: after.label, key: after.key, section: afterSection.title, kind, details, impact };
}

function diffSection(before: FormSection, after: FormSection): SectionChange | null {
  const details: string[] = [];
  let impact: Impact = { ...NONE };
  const scoring = [...before.fields, ...after.fields].some(isScoring);
  if (before.title !== after.title) details.push(`Title ${q(before.title)} → ${q(after.title)}`);
  if (before.phase !== after.phase) {
    details.push(`Phase ${before.phase} → ${after.phase}`);
    impact = or(impact, { scores: scoring, data: false });
  }
  if (before.visible !== after.visible) {
    details.push(after.visible ? "Now shown" : "Now hidden from scouts");
    impact = or(impact, { scores: scoring, data: after.fields.length > 0 });
  }
  if ((before.accent ?? "") !== (after.accent ?? "")) details.push("Accent colour changed");
  const bg = new Map((before.groups ?? []).map((g) => [g.id, g.title]));
  const ag = new Map((after.groups ?? []).map((g) => [g.id, g.title]));
  for (const [id, title] of ag) {
    if (!bg.has(id)) details.push(`Group added: ${q(title)}`);
    else if (bg.get(id) !== title) details.push(`Group renamed ${q(bg.get(id)!)} → ${q(title)}`);
  }
  for (const [id, title] of bg) if (!ag.has(id)) details.push(`Group removed: ${q(title)}`);
  if (details.length === 0) return null;
  return { id: after.id, title: after.title, kind: "changed", details, impact };
}

/** What changed from `before` to `after`. Pure; `before` may be a version, a built-in, or a draft. */
export function diffForms(before: Form, after: Form): FormDiff {
  const form: string[] = [];
  let impact: Impact = { ...NONE };

  if (before.name !== after.name) form.push(`Name ${q(before.name)} → ${q(after.name)}`);
  if (before.description !== after.description) form.push("Description changed");
  if (!same(before.tags, after.tags)) form.push("Tags changed");
  if (before.scoringEnabled !== after.scoringEnabled) {
    form.push(after.scoringEnabled ? "Scoring turned on" : "Scoring turned off (entries get no score or accuracy)");
    impact = or(impact, { scores: true, data: true });
  }
  if (!same(before.keyAliases, after.keyAliases)) form.push("Key aliases changed");
  if (!same(before.phaseLabels, after.phaseLabels)) form.push("Phase labels changed");

  const beforeFields = new Map<string, { field: FormField; section: FormSection }>();
  for (const s of before.sections) for (const f of s.fields) beforeFields.set(f.id, { field: f, section: s });
  const afterFields = new Map<string, { field: FormField; section: FormSection }>();
  for (const s of after.sections) for (const f of s.fields) afterFields.set(f.id, { field: f, section: s });

  const fields: FieldChange[] = [];
  for (const section of after.sections) {
    for (const f of section.fields) {
      const prior = beforeFields.get(f.id);
      if (!prior) {
        fields.push({ id: f.id, label: f.label, key: f.key, section: section.title, kind: "added", details: [`Added ${f.type}${isScoring(f) ? ` (${describeScoring(f.scoring)})` : ""}`], impact: { scores: isScoring(f), data: true } });
        continue;
      }
      const change = diffField(prior.field, f, prior.section, section, after);
      if (change) fields.push(change);
    }
  }
  for (const s of before.sections) {
    for (const f of s.fields) {
      if (!afterFields.has(f.id)) fields.push({ id: f.id, label: f.label, key: f.key, section: s.title, kind: "removed", details: [`Removed ${f.type}${isScoring(f) ? ` (was ${describeScoring(f.scoring)})` : ""}`], impact: { scores: isScoring(f), data: true } });
    }
  }

  const sections: SectionChange[] = [];
  const beforeSections = new Map(before.sections.map((s) => [s.id, s]));
  for (const s of after.sections) {
    const prior = beforeSections.get(s.id);
    if (!prior) {
      sections.push({ id: s.id, title: s.title, kind: "added", details: [`Added category ${q(s.title)} (${s.phase})`], impact: { scores: false, data: false } });
      continue;
    }
    const change = diffSection(prior, s);
    if (change) sections.push(change);
  }
  const afterSectionIds = new Set(after.sections.map((s) => s.id));
  for (const s of before.sections) if (!afterSectionIds.has(s.id)) sections.push({ id: s.id, title: s.title, kind: "removed", details: [`Removed category ${q(s.title)}`], impact: { scores: false, data: false } });

  for (const c of [...fields, ...sections]) impact = or(impact, c.impact);
  const all = [...fields, ...sections];
  return {
    form,
    sections,
    fields,
    impact,
    empty: form.length === 0 && sections.length === 0 && fields.length === 0,
    counts: {
      added: all.filter((c) => c.kind === "added").length,
      removed: all.filter((c) => c.kind === "removed").length,
      changed: all.filter((c) => c.kind === "changed" || c.kind === "moved").length + form.length,
    },
  };
}
