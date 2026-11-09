"use client";

import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { describeScoring } from "@/lib/forms/diff";
import { calculateScore, maxScore } from "@/lib/forms/scoring";
import { formFieldMeta } from "@/lib/forms/meta";
import { defaultValues, normalizeValues } from "@/lib/forms/values";
import { visibleFieldKeys } from "@/lib/forms/visibility";
import { phaseLabel, type FieldValue, type Form, type FormField } from "@/lib/forms/types";

// P22: the scoring summary: every field that scores, with its points; each phase's subtotal ceiling and the total ceiling (where the form has a
// fixed maximum: a counter with no maximum makes it open-ended); and a scenario calculator ("what score does this combination give?") that uses
// the real scoring function, so it can't disagree with what a scout's entry would score.

export function ScoringSummary({ form }: { form: Form }) {
  const rows = useMemo(() => formFieldMeta(form).filter((m) => m.scored), [form]);
  const max = useMemo(() => maxScore(form), [form]);
  const [picked, setPicked] = useState<Record<string, FieldValue>>({});
  const values = useMemo(() => normalizeValues(form, { ...defaultValues(form), ...picked }), [form, picked]);
  const visible = useMemo(() => visibleFieldKeys(form, values), [form, values]);
  const score = useMemo(() => calculateScore(form, values), [form, values]);
  const set = (key: string, v: FieldValue) => setPicked((p) => ({ ...p, [key]: v }));

  if (!form.scoringEnabled) {
    return (
      <p className="rounded-2xl border border-[var(--glass-border)] p-3 text-sm text-[var(--muted-foreground)]" data-testid="scoring-off">
        Scoring is off for this form: entries get no score and accuracy shows n/a. Turn it on in Form settings to add points.
      </p>
    );
  }

  const phases = Object.keys({ ...score.byPhase, ...max.byPhase }).filter((p) => p !== "prematch");

  return (
    <div className="flex flex-col gap-5" data-testid="scoring-summary">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">What scores</h3>
        {rows.length === 0 ? (
          <p className="text-xs text-amber-300">Nothing scores yet. Give a field points in its Scoring section.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {rows.map((m) => (
              <li key={m.field.id} className="flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5 text-xs">
                <span className="min-w-0">
                  <span className="font-medium">{m.field.label}</span>
                  <span className="block text-[var(--muted-foreground)]">{phaseLabel(form, m.phase)}</span>
                </span>
                <span className="shrink-0 text-right font-medium">{describeScoring(m.field.scoring)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Most it can give</h3>
        <ul className="grid grid-cols-2 gap-1.5 text-xs" data-testid="score-max">
          {phases.map((p) => (
            <li key={p} className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5">
              <span>{phaseLabel(form, p)}</span>
              <span className="font-semibold tabular-nums">{max.byPhase[p] ?? "no limit"}</span>
            </li>
          ))}
          <li className="col-span-2 flex items-center justify-between rounded-xl border border-[var(--glass-border)] bg-white/[0.05] px-2.5 py-1.5">
            <span className="font-medium">Total</span>
            <span className="font-semibold tabular-nums">{max.total ?? "no limit (a counter has no maximum)"}</span>
          </li>
        </ul>
        {max.total === null && <p className="text-[11px] text-[var(--muted-foreground)]">Give counters a maximum (or the field a points cap) to get a fixed top score.</p>}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Scenario calculator</h3>
        <p className="text-xs text-[var(--muted-foreground)]">Set values and see the score. Fields hidden by a condition don&apos;t count.</p>
        <div className="flex flex-col gap-1.5">
          {rows.map((m) => (
            <ScenarioControl key={m.field.id} field={m.field} value={values[m.field.key] as FieldValue | undefined} enabled={visible.has(m.field.key)} onChange={(v) => set(m.field.key, v)} />
          ))}
        </div>
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-2xl border border-[var(--glass-border)] bg-white/[0.05] px-3 py-2" data-testid="scenario-total">
          <span className="text-xs text-[var(--muted-foreground)]">Score</span>
          <span className="text-2xl font-bold tabular-nums">{score.total}</span>
          {phases.map((p) => (
            <span key={p} className="text-xs text-[var(--muted-foreground)]">
              {phaseLabel(form, p)} {score.byPhase[p] ?? 0}
            </span>
          ))}
        </div>
      </section>
    </div>
  );
}

function ScenarioControl({ field, value, enabled, onChange }: { field: FormField; value: FieldValue | undefined; enabled: boolean; onChange: (v: FieldValue) => void }) {
  const label = (
    <span className="min-w-0 truncate text-xs">
      {field.label}
      {!enabled && <Badge variant="outline" className="ml-1.5">hidden</Badge>}
    </span>
  );
  switch (field.type) {
    case "toggle":
    case "checkbox":
      return (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5">
          {label}
          <Switch aria-label={field.label} checked={value === true} disabled={!enabled} onCheckedChange={onChange} />
        </div>
      );
    case "select":
    case "radio":
      return (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5">
          {label}
          <select aria-label={field.label} disabled={!enabled} value={String(value ?? "")} onChange={(e) => onChange(e.target.value)} className="h-9 rounded-xl border border-[var(--glass-border)] bg-[var(--background)] px-2 text-xs">
            <option value="">(none)</option>
            {(field.options ?? []).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
                {o.points ? ` (${o.points})` : ""}
              </option>
            ))}
          </select>
        </div>
      );
    default:
      return (
        <div className="flex items-center justify-between gap-2 rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5">
          {label}
          <Input aria-label={field.label} type="number" inputMode="decimal" disabled={!enabled} className="h-9 w-24 px-2 text-sm" value={typeof value === "number" || typeof value === "string" ? value : 0} min={field.min ?? 0} onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))} />
        </div>
      );
  }
}
