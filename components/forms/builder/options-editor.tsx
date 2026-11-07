"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { updateField } from "@/lib/forms/edit";
import type { FieldOption, FormField } from "@/lib/forms/types";
import { FORM_LIMITS } from "@/lib/forms/validate";
import { useBuilder } from "@/components/forms/builder/context";

// P22: the options of a dropdown / pick-one field: label, stored value, and (when the field scores by option) points. The stored value follows the
// label while it still matches (new options), so the author doesn't have to think about it; editing it by hand stops that, and changing a value
// that entries already use is flagged ("affects data") in the version diff.

const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || "option";

function uniqueValue(options: FieldOption[], base: string, except?: number): string {
  const taken = new Set(options.filter((_, i) => i !== except).map((o) => o.value));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 100; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`.slice(0, 60);
  return `${base}_${Date.now() % 1000}`;
}

export function OptionsEditor({ field }: { field: FormField }) {
  const { update, compact } = useBuilder();
  const options = field.options ?? [];
  const byOption = field.scoring?.mode === "byOption";
  const set = (next: FieldOption[], key = `opts:${field.id}`) => update((f) => updateField(f, field.id, { options: next }), key);
  const patch = (i: number, p: Partial<FieldOption>, key?: string) => set(options.map((o, j) => (j === i ? { ...o, ...p } : o)), key);

  return (
    <div className="flex flex-col gap-2">
      {options.map((o, i) => (
        <div key={i} className="flex flex-col gap-1.5 rounded-xl border border-[var(--glass-border)] bg-white/[0.03] p-2">
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={`Option ${i + 1} label`}
              value={o.label}
              maxLength={FORM_LIMITS.optionLabel}
              onChange={(e) => {
                const label = e.target.value;
                const follows = o.value === slug(o.label) || o.value === uniqueValue(options, slug(o.label), i) || /^option\d+$/.test(o.value);
                patch(i, follows ? { label, value: uniqueValue(options, slug(label), i) } : { label }, `opt:${field.id}:${i}`);
              }}
            />
            {!compact && (
              <>
                <Button variant="ghost" size="icon" aria-label={`Move option ${i + 1} up`} disabled={i === 0} onClick={() => set(swap(options, i, i - 1))}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Move option ${i + 1} down`} disabled={i === options.length - 1} onClick={() => set(swap(options, i, i + 1))}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button variant="ghost" size="icon" aria-label={`Delete option ${i + 1}`} disabled={options.length <= 2} onClick={() => set(options.filter((_, j) => j !== i))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <Input aria-label={`Option ${i + 1} stored value`} className="font-mono text-xs" value={o.value} maxLength={60} onChange={(e) => patch(i, { value: e.target.value.replace(/\s+/g, "_") }, `optv:${field.id}:${i}`)} />
            {byOption && (
              <Input
                aria-label={`Option ${i + 1} points`}
                type="number"
                inputMode="decimal"
                className="w-24"
                placeholder="pts"
                value={o.points ?? ""}
                onChange={(e) => patch(i, { points: e.target.value === "" ? undefined : Number(e.target.value) }, `optp:${field.id}:${i}`)}
              />
            )}
          </div>
        </div>
      ))}
      {!compact && (
        <Button variant="glass" size="sm" className="self-start gap-1.5" disabled={options.length >= FORM_LIMITS.options} onClick={() => set([...options, { value: uniqueValue(options, `option${options.length + 1}`), label: `Option ${options.length + 1}` }])}>
          <Plus className="h-4 w-4" /> Add option
        </Button>
      )}
    </div>
  );
}

function swap<T>(list: T[], a: number, b: number): T[] {
  const next = [...list];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
