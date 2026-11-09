"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, Copy, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FIELD_ICON_NAMES } from "@/components/scout/field-icons";
import { Group, NumberRow, SelectRow, SwitchRow, TextRow } from "@/components/forms/builder/controls";
import { ConditionEditor } from "@/components/forms/builder/condition-editor";
import { OptionsEditor } from "@/components/forms/builder/options-editor";
import { ImageSettings, MatrixSettings, SequenceSettings, SliderSettings } from "@/components/forms/builder/p27-inspectors";
import { useBuilder } from "@/components/forms/builder/context";
import { changeFieldType, duplicateField, FIELD_TYPE_LABEL, findField, isSystemField, keyFromLabel, keyProblem, moveFieldBy, removeField, setFieldKey, uniqueKey, updateField } from "@/lib/forms/edit";
import { scoringModesFor, FORM_LIMITS } from "@/lib/forms/validate";
import { STAT_ROLES, USER_FIELD_TYPES, type AggregateKind, type FieldUi, type FormField, type ScoringMode, type StatRole, type UserFieldType } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

const SCORING_LABEL: Record<ScoringMode, string> = {
  none: "Doesn't score",
  whenOn: "Points when on",
  perTally: "Points per tally",
  perUnit: "Points per unit",
  byOption: "Points by option",
};

const AGGREGATES: { value: AggregateKind; label: string }[] = [
  { value: "avg", label: "Average per match" },
  { value: "sum", label: "Total" },
  { value: "rate", label: "Share of matches (%)" },
  { value: "last", label: "Most recent" },
  { value: "list", label: "List of values" },
];

const ROLE_INFO: Record<StatRole, { label: string; hint: string; types: "any" | "boolean" | "text" }> = {
  primaryScoring: { label: "Headline scoring element", hint: "Shown first on Team Profile and cards.", types: "any" },
  reliability: { label: "Robot failure", hint: "Counts toward Team Breakdown's reliability pill.", types: "boolean" },
  neverStarted: { label: "Never started", hint: "A robot that never started isn't flagged for zero scoring.", types: "boolean" },
  died: { label: "Died during match", hint: "A robot that died isn't flagged for zero scoring.", types: "boolean" },
  disabled: { label: "Disabled by FTC", hint: "Flags a full scoring run that was also disabled.", types: "boolean" },
  recoveredFromFreeze: { label: "Recovered from freeze", hint: "Flags it together with never started.", types: "boolean" },
  comments: { label: "The comments field", hint: "Its text is the entry's summary comment in Match Analytics.", types: "text" },
};

const roleAllowed = (role: StatRole, f: FormField): boolean => {
  const t = ROLE_INFO[role].types;
  return t === "any" || (t === "boolean" ? f.type === "toggle" || f.type === "checkbox" : f.type === "text" || f.type === "textarea");
};

export function FieldInspector({ field }: { field: FormField }) {
  const { form, update, select, publishedKeys, compact, issues, entryCount } = useBuilder();
  const system = isSystemField(field);
  const mine = issues.filter((i) => i.fieldId === field.id);
  const patch = (p: Partial<FormField>, coalesce?: string) => update((f) => updateField(f, field.id, p), coalesce ?? `f:${field.id}:${Object.keys(p).join(",")}`);
  const hit = findField(form, field.id);

  // The key box keeps what's being typed even while it's not usable yet.
  const [draft, setDraft] = useState<{ forKey: string; value: string } | null>(null);
  const keyDraft = draft && draft.forKey === field.key ? draft.value : field.key;
  const setKeyDraft = (value: string) => setDraft({ forKey: field.key, value });
  const keyIssue = keyDraft === field.key ? null : keyProblem(form, field.id, keyDraft);
  const keyPublished = publishedKeys.has(field.key);
  const autoKey = !keyPublished && field.key.replace(/\d+$/, "") === keyFromLabel(field.label).replace(/\d+$/, "");

  const setLabel = (label: string) =>
    update((f) => {
      let next = updateField(f, field.id, { label });
      if (autoKey && label.trim()) next = setFieldKey(next, field.id, uniqueKey(next, keyFromLabel(label), field.id), publishedKeys);
      return next;
    }, `label:${field.id}`);

  const mode = field.scoring?.mode ?? "none";
  const scoringModes = scoringModesFor(field.type);
  const numeric = field.type === "counter" || field.type === "number";
  const ui = field.ui ?? {};
  const setUi = (p: Partial<FieldUi>) => {
    const next = { ...ui, ...p };
    for (const k of Object.keys(next) as (keyof FieldUi)[]) if (next[k] === undefined) delete next[k];
    patch({ ui: Object.keys(next).length > 0 ? next : undefined }, `ui:${field.id}`);
  };
  const analytics = field.analytics ?? { include: true };
  const setAnalytics = (p: Partial<NonNullable<FormField["analytics"]>>) => {
    const next = { ...analytics, ...p };
    for (const k of Object.keys(next) as (keyof typeof next)[]) if (next[k] === undefined || next[k] === "") delete next[k];
    patch({ analytics: next as NonNullable<FormField["analytics"]> }, `an:${field.id}`);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="field-inspector">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="glass">{FIELD_TYPE_LABEL[field.type]}</Badge>
        {system && <Badge variant="outline">Locked: required, always in Pre-Match</Badge>}
        {entryCount > 0 && !system && <Badge variant="outline">{entryCount} entries use this form</Badge>}
        {!compact && !system && (
          <div className="ml-auto flex gap-1">
            <Button variant="ghost" size="icon" aria-label="Move field up" onClick={() => update((f) => moveFieldBy(f, field.id, -1))}>
              <ArrowUp className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" aria-label="Move field down" onClick={() => update((f) => moveFieldBy(f, field.id, 1))}>
              <ArrowDown className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Duplicate field"
              onClick={() => {
                let id: string | null = null;
                update((f) => {
                  const r = duplicateField(f, field.id);
                  id = r.id;
                  return r.form;
                });
                if (id) select({ kind: "field", id });
              }}
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label="Delete field"
              className="text-red-300"
              onClick={() => {
                update((f) => removeField(f, field.id));
                select({ kind: "form" });
              }}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {mine.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-xl border border-[var(--glass-border)] p-2 text-xs" aria-label="Problems with this field">
          {mine.map((i, n) => (
            <li key={n} className={i.severity === "error" ? "text-red-300" : "text-amber-300"}>
              {i.severity === "error" ? "Error: " : "Tip: "}
              {i.message}
            </li>
          ))}
        </ul>
      )}

      <Group title="Basics">
        <TextRow label="Label" value={field.label} maxLength={FORM_LIMITS.label} disabled={system} onChange={setLabel} invalid={!field.label.trim()} />
        {!system && (
          <TextRow
            label="Data key"
            mono
            value={keyDraft}
            maxLength={40}
            invalid={!!keyIssue}
            onChange={(v) => {
              setKeyDraft(v);
              if (!keyProblem(form, field.id, v)) update((f) => setFieldKey(f, field.id, v, publishedKeys), `key:${field.id}`);
            }}
            hint={
              keyIssue ? (
                <span className="text-red-300">{keyIssue}</span>
              ) : keyPublished ? (
                "This key is in a published version. Changing it leaves an alias, so old entries still read under the new key."
              ) : autoKey ? (
                "Follows the label until you edit it. It's what CSV and stats use."
              ) : (
                "What CSV and stats use. Unique in this form."
              )
            }
          />
        )}
        {!system && (
          <SelectRow
            label="Field type"
            value={field.type as UserFieldType}
            onChange={(t) => t && update((f) => changeFieldType(f, field.id, t))}
            options={USER_FIELD_TYPES.map((t) => ({ value: t, label: FIELD_TYPE_LABEL[t] }))}
            hint="Changing the type keeps the label, key and condition, and drops settings that don't fit."
          />
        )}
        <TextRow label="Help text" value={field.helpText ?? ""} maxLength={FORM_LIMITS.helpText} onChange={(v) => patch({ helpText: v || undefined })} hint="Shown under the label." />
        <TextRow label="Scouting tip" multiline value={field.tip ?? ""} maxLength={FORM_LIMITS.tip} onChange={(v) => patch({ tip: v || undefined })} hint="A small (i) popover beside the field while scouting." />
        {(field.type === "text" || field.type === "textarea" || field.type === "number") && (
          <TextRow label="Placeholder" value={field.placeholder ?? ""} maxLength={FORM_LIMITS.placeholder} onChange={(v) => patch({ placeholder: v || undefined })} />
        )}
        {!system && <SwitchRow label="Required" hint={field.type === "toggle" || field.type === "checkbox" ? "A required toggle must be on (an \"I confirm\")." : "Scouts can't submit without it (while it's visible)."} checked={!!field.required} onChange={(v) => patch({ required: v || undefined })} />}
        {!system && <DefaultValue field={field} patch={patch} />}
      </Group>

      {field.type === "counter" && (
        <Group title="Counter">
          <NumberRow label="Minimum" value={field.min} onChange={(v) => patch({ min: v })} />
          <NumberRow label="Maximum" value={field.max} onChange={(v) => patch({ max: v })} hint="Empty = no limit." />
          <NumberRow label="Step" value={field.step} min={0.001} onChange={(v) => patch({ step: v })} hint="How much each tap adds." />
        </Group>
      )}
      {field.type === "number" && (
        <Group title="Number">
          <NumberRow label="Minimum" value={field.min} onChange={(v) => patch({ min: v })} />
          <NumberRow label="Maximum" value={field.max} onChange={(v) => patch({ max: v })} />
          <NumberRow label="Decimal places" value={field.decimals} min={0} max={6} step={1} onChange={(v) => patch({ decimals: v === undefined ? undefined : Math.round(v) })} />
        </Group>
      )}
      {field.type === "rating" && (
        <Group title="Rating">
          <NumberRow label="Stars" value={field.scale} min={2} max={10} step={1} onChange={(v) => patch({ scale: v === undefined ? undefined : Math.round(v) })} hint="2 to 10." />
        </Group>
      )}
      {field.type === "slider" && <SliderSettings field={field} patch={patch} />}
      {field.type === "image" && <ImageSettings field={field} patch={patch} />}
      {field.type === "sequence" && <SequenceSettings field={field} patch={patch} />}
      {field.type === "matrix" && <MatrixSettings field={field} patch={patch} />}
      {(field.type === "select" || field.type === "radio") && (
        <Group title="Options">
          <OptionsEditor field={field} />
        </Group>
      )}

      {!system && (
        <Group title="Visibility" badge={field.visibleWhen ? <Badge variant="outline">conditional</Badge> : undefined} defaultOpen={!!field.visibleWhen}>
          <ConditionEditor field={field} />
        </Group>
      )}

      {!system && (
        <Group title="Scoring" badge={mode !== "none" ? <Badge variant="glass">{SCORING_LABEL[mode]}</Badge> : undefined} defaultOpen={mode !== "none"}>
          {!form.scoringEnabled && <p className="text-xs text-amber-300">Scoring is off for this form: points here don&apos;t count until it&apos;s turned on in Form settings.</p>}
          <SelectRow
            label="Points"
            value={mode}
            onChange={(m) => patch({ scoring: m && m !== "none" ? { ...field.scoring, mode: m, value: m === "byOption" ? undefined : (field.scoring?.value ?? 1) } : { mode: "none" } }, `sc:${field.id}`)}
            options={scoringModes.map((m) => ({ value: m as ScoringMode, label: SCORING_LABEL[m as ScoringMode] }))}
            hint="Points go to the phase of the category this field is in."
          />
          {mode !== "none" && mode !== "byOption" && <NumberRow label={mode === "whenOn" ? "Points when on" : mode === "perTally" ? "Points per tally" : "Points per unit"} value={field.scoring?.value} onChange={(v) => patch({ scoring: { ...field.scoring!, value: v } }, `scv:${field.id}`)} />}
          {mode === "byOption" && <p className="text-xs text-[var(--muted-foreground)]">Set each option&apos;s points under Options.</p>}
          {mode !== "none" && <NumberRow label="Most points this field can give" value={field.scoring?.cap} min={0} onChange={(v) => patch({ scoring: { ...field.scoring!, cap: v } }, `scc:${field.id}`)} hint="Optional cap." />}
        </Group>
      )}

      <Group title="Analytics, stats and CSV" defaultOpen={false}>
        <SwitchRow label="Include in analytics" hint="A column in Match Analytics and the CSV, and a team stat." checked={analytics.include} onChange={(v) => setAnalytics({ include: v })} />
        {analytics.include && (
          <>
            <TextRow label="Column label" value={analytics.label ?? ""} placeholder={field.label} onChange={(v) => setAnalytics({ label: v })} />
            <TextRow label="Column group (middle header)" value={analytics.category ?? ""} placeholder="The group or category title" onChange={(v) => setAnalytics({ category: v })} />
            <SelectRow label="Team stat" value={analytics.aggregate} allowNone noneLabel="Default for this type" onChange={(v) => setAnalytics({ aggregate: v })} options={AGGREGATES} />
            <TextRow label="CSV header" mono value={analytics.csvHeader ?? ""} placeholder="Phase - Category - Label" maxLength={160} onChange={(v) => setAnalytics({ csvHeader: v })} hint="Overrides the generated header. Importing a CSV matches columns by this header." />
            <TextRow label="Game element" value={analytics.element ?? ""} placeholder="e.g. Hive" onChange={(v) => setAnalytics({ element: v })} hint="Groups this field's points with other fields on the same element, across phases (Team Profile)." />
          </>
        )}
        {!system && (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-xs font-medium">Flags and stats roles</legend>
            {STAT_ROLES.filter((r) => roleAllowed(r, field)).map((role) => {
              const on = !!field.statRoles?.includes(role);
              return (
                <label key={role} className="flex min-h-9 items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4 accent-[var(--color-primary)]"
                    checked={on}
                    onChange={() => {
                      const roles = on ? (field.statRoles ?? []).filter((r) => r !== role) : [...(field.statRoles ?? []), role];
                      patch({ statRoles: roles.length > 0 ? roles : undefined }, `roles:${field.id}`);
                    }}
                  />
                  <span>
                    {ROLE_INFO[role].label}
                    <span className="block text-[11px] text-[var(--muted-foreground)]">{ROLE_INFO[role].hint}</span>
                  </span>
                </label>
              );
            })}
          </fieldset>
        )}
        {numeric && !system && <NumberRow label="Flag as unrealistic above" value={field.unrealisticAbove} onChange={(v) => patch({ unrealisticAbove: v })} hint="Entries above this get an automatic flag." />}
      </Group>

      <Group title="Look" defaultOpen={false}>
        <SelectRow label="Touch target size" value={ui.size} allowNone noneLabel="Medium (default)" onChange={(v) => setUi({ size: v })} options={[{ value: "sm", label: "Small" }, { value: "md", label: "Medium" }, { value: "lg", label: "Large" }]} />
        <SelectRow label="Accent colour" value={ui.color} allowNone noneLabel="None" onChange={(v) => setUi({ color: v })} options={(["primary", "secondary", "accent", "success", "warning", "danger"] as const).map((c) => ({ value: c, label: c[0].toUpperCase() + c.slice(1) }))} hint="Theme colours only, so the text stays legible in every theme." />
        <SelectRow label="Icon" value={ui.icon} allowNone noneLabel="None" onChange={(v) => setUi({ icon: v })} options={FIELD_ICON_NAMES.map((n) => ({ value: n, label: n.replace(/-/g, " ") }))} />
        <SelectRow label="Width" value={ui.width} allowNone noneLabel="Full" onChange={(v) => setUi({ width: v })} options={[{ value: "half", label: "Half (two per row)" }]} />
        {hit && <p className={cn("text-[11px] text-[var(--muted-foreground)]")}>In &ldquo;{hit.section.title}&rdquo;.</p>}
      </Group>
    </div>
  );
}

function DefaultValue({ field, patch }: { field: FormField; patch: (p: Partial<FormField>, coalesce?: string) => void }) {
  switch (field.type) {
    case "toggle":
    case "checkbox":
      return <SwitchRow label="On by default" checked={field.default === true} onChange={(v) => patch({ default: v ? true : undefined })} />;
    case "counter":
    case "number":
    case "rating":
      return <NumberRow label="Default value" value={typeof field.default === "number" ? field.default : undefined} onChange={(v) => patch({ default: v })} />;
    case "select":
    case "radio":
      return <SelectRow label="Default choice" value={typeof field.default === "string" ? field.default : undefined} allowNone noneLabel="None (scout must choose)" onChange={(v) => patch({ default: v })} options={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))} />;
    case "text":
    case "textarea":
      return <TextRow label="Default text" value={typeof field.default === "string" ? field.default : ""} maxLength={500} onChange={(v) => patch({ default: v || undefined })} />;
    default:
      return null;
  }
}
