"use client";

import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Group, NumberRow, SelectRow, SwitchRow, TextRow } from "@/components/forms/builder/controls";
import { keyFromLabel } from "@/lib/forms/edit";
import { FORM_LIMITS } from "@/lib/forms/validate";
import type { FormField, MatrixAxis, SequenceStep } from "@/lib/forms/types";

// P27: the inspector sections for the new field types (slider, photos, step sequence, checkbox grid). Each is a few controls over the field's own settings;
// `checkForm` (the Problems tab) reports anything wrong with them, and the Preview shows the real control.

type Patch = (p: Partial<FormField>, coalesce?: string) => void;

export function SliderSettings({ field, patch }: { field: FormField; patch: Patch }) {
  return (
    <Group title="Slider">
      <NumberRow label="Minimum" value={field.min ?? 1} step={1} onChange={(v) => patch({ min: v === undefined ? undefined : Math.round(v) })} hint="A whole number." />
      <NumberRow label="Maximum" value={field.max ?? 5} step={1} onChange={(v) => patch({ max: v === undefined ? undefined : Math.round(v) })} />
      <NumberRow label="Step" value={field.step ?? 1} min={1} step={1} onChange={(v) => patch({ step: v === undefined ? undefined : Math.round(v) })} hint="At most 100 steps along the track." />
      <SwitchRow label="Tick marks" hint="Shows the numbers along the track." checked={field.ticks === true} onChange={(v) => patch({ ticks: v || undefined })} />
      <TextRow label="Left end label" value={field.endLabels?.min ?? ""} maxLength={40} onChange={(v) => patch({ endLabels: { ...field.endLabels, min: v || undefined } }, `sl:${field.id}:min`)} placeholder="e.g. Low" />
      <TextRow label="Right end label" value={field.endLabels?.max ?? ""} maxLength={40} onChange={(v) => patch({ endLabels: { ...field.endLabels, max: v || undefined } }, `sl:${field.id}:max`)} placeholder="e.g. High" />
    </Group>
  );
}

export function ImageSettings({ field, patch }: { field: FormField; patch: Patch }) {
  return (
    <Group title="Photos">
      <NumberRow label="Most photos" value={field.maxCount ?? 1} min={1} max={FORM_LIMITS.imagesPerField} step={1} onChange={(v) => patch({ maxCount: v === undefined ? undefined : Math.round(v) })} hint={`1 to ${FORM_LIMITS.imagesPerField}.`} />
      <SwitchRow label="Open the camera on phones" hint="Otherwise phones offer the camera and the photo library." checked={field.capture === true} onChange={(v) => patch({ capture: v || undefined })} />
      <p className="text-xs text-[var(--muted-foreground)]">Photos are shrunk to about 1600 px and uploaded to Vercel Blob (6 MB at most each). In the preview they upload in the live form only.</p>
    </Group>
  );
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base || "step";
  for (let i = 2; taken.has(id); i++) id = `${base || "step"}${i}`;
  return id;
}

export function SequenceSettings({ field, patch }: { field: FormField; patch: Patch }) {
  const steps = field.steps ?? [];
  const set = (next: SequenceStep[], coalesce?: string) => patch({ steps: next }, coalesce ?? `seq:${field.id}`);
  const edit = (i: number, p: Partial<SequenceStep>, coalesce?: string) => set(steps.map((s, j) => (j === i ? { ...s, ...p } : s)), coalesce);
  return (
    <Group title="Steps to choose from">
      <p className="text-xs text-[var(--muted-foreground)]">Scouts tap steps to build the order. A step pinned to the start or end stays there; the others can be dragged.</p>
      <ul className="flex flex-col gap-3">
        {steps.map((s, i) => (
          <li key={i} className="glass-card flex flex-col gap-2 p-2.5" data-testid={`step-row-${i}`}>
            <TextRow label={`Step ${i + 1} label`} value={s.label} maxLength={FORM_LIMITS.label} onChange={(v) => edit(i, { label: v }, `seq:${field.id}:${i}`)} />
            <SwitchRow label="Only once" hint="Off = it can be added as often as wanted." checked={s.maxCount === 1} onChange={(v) => edit(i, { maxCount: v ? 1 : 0, ...(v ? {} : { pin: null }) })} />
            <SelectRow
              label="Pinned"
              value={s.pin ?? undefined}
              allowNone
              noneLabel="Not pinned (can move)"
              onChange={(v) => edit(i, { pin: v ?? null, ...(v ? { maxCount: 1 as const } : {}) })}
              options={[
                { value: "first", label: "Always first" },
                { value: "last", label: "Always last" },
              ]}
            />
            <Button variant="ghost" size="sm" className="self-start gap-1.5 text-red-300" onClick={() => set(steps.filter((_, j) => j !== i))} aria-label={`Remove step ${s.label}`}>
              <Trash2 className="h-3.5 w-3.5" /> Remove
            </Button>
          </li>
        ))}
      </ul>
      <Button
        variant="glass"
        size="sm"
        className="self-start gap-1.5"
        disabled={steps.length >= FORM_LIMITS.steps}
        onClick={() => {
          const label = `Step ${steps.length + 1}`;
          set([...steps, { id: uniqueId(keyFromLabel(label), new Set(steps.map((x) => x.id))), label, maxCount: 0, pin: null }]);
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Add a step
      </Button>
    </Group>
  );
}

function AxisEditor({ title, axis, onChange }: { title: string; axis: MatrixAxis[]; onChange: (next: MatrixAxis[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold">{title}</h4>
      {axis.map((a, i) => (
        <div key={i} className="flex items-end gap-2" data-testid={`${title.toLowerCase()}-${i}`}>
          <div className="min-w-0 flex-1">
            <TextRow label={`${title.slice(0, -1)} ${i + 1}`} value={a.label} maxLength={FORM_LIMITS.label} onChange={(v) => onChange(axis.map((x, j) => (j === i ? { ...x, label: v } : x)))} />
          </div>
          <Button variant="ghost" size="icon" className="mb-0.5 h-9 w-9 shrink-0 text-red-300" aria-label={`Remove ${a.label}`} onClick={() => onChange(axis.filter((_, j) => j !== i))}>
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button
        variant="glass"
        size="sm"
        className="self-start gap-1.5"
        disabled={axis.length >= FORM_LIMITS.matrixAxis}
        onClick={() => {
          const label = `${title.slice(0, -1)} ${axis.length + 1}`;
          onChange([...axis, { key: uniqueId(keyFromLabel(label), new Set(axis.map((x) => x.key))), label }]);
        }}
      >
        <Plus className="h-3.5 w-3.5" /> Add {title.slice(0, -1).toLowerCase()}
      </Button>
    </div>
  );
}

export function MatrixSettings({ field, patch }: { field: FormField; patch: Patch }) {
  const rows = field.rows ?? [];
  const cols = field.cols ?? [];
  const off = new Set(field.disabledCells ?? []);
  // A cell that no longer exists (its row or column was removed) can't stay disabled: drop it with the change.
  const cleaned = (r: MatrixAxis[], c: MatrixAxis[], disabled: string[]) => {
    const valid = new Set(r.flatMap((x) => c.map((y) => `${x.key}_${y.key}`)));
    return disabled.filter((d) => valid.has(d));
  };
  return (
    <Group title="Grid">
      <p className="text-xs text-[var(--muted-foreground)]">Each cell is one yes/no answer, saved and exported as its own column.</p>
      <AxisEditor title="Rows" axis={rows} onChange={(next) => patch({ rows: next, disabledCells: cleaned(next, cols, [...off]) }, `mx:${field.id}:rows`)} />
      <AxisEditor title="Columns" axis={cols} onChange={(next) => patch({ cols: next, disabledCells: cleaned(rows, next, [...off]) }, `mx:${field.id}:cols`)} />
      {rows.length > 0 && cols.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold">Cells offered</h4>
          <p className="text-[11px] text-[var(--muted-foreground)]">Untick a cell that doesn&apos;t apply (say, &ldquo;Leave&rdquo; in the Endgame column).</p>
          <div className="glass-card overflow-x-auto p-2">
            <table className="text-xs">
              <thead>
                <tr>
                  <th />
                  {cols.map((c) => (
                    <th key={c.key} className="px-2 py-1 font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <th className="whitespace-nowrap px-2 py-1 text-left font-medium">{r.label}</th>
                    {cols.map((c) => {
                      const cell = `${r.key}_${c.key}`;
                      return (
                        <td key={c.key} className="px-2 py-1 text-center">
                          <Checkbox
                            checked={!off.has(cell)}
                            aria-label={`${r.label}, ${c.label} is offered`}
                            data-testid={`cell-${cell}`}
                            className="mx-auto h-6 w-6"
                            onCheckedChange={(v) => patch({ disabledCells: v === true ? [...off].filter((d) => d !== cell) : [...off, cell] }, `mx:${field.id}:cells`)}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Group>
  );
}
