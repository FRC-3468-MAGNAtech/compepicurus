"use client";

import { useMemo } from "react";
import { repeatGroupOf } from "@/lib/forms/repeat";
import { isSystemField, type FormField, type VisibleWhen } from "@/lib/forms/types";
import { allFormFields } from "@/lib/forms/validate";
import { updateField } from "@/lib/forms/edit";
import { NumberRow, SelectRow, TextRow } from "@/components/forms/builder/controls";
import { useBuilder } from "@/components/forms/builder/context";

// P22: the visibility-condition builder: "show this field only when <another field> <is on | is greater than | equals> <value>". The operators and
// the value control follow the other field's type, so a nonsense condition (a checkbox "greater than" 3) can't be built; the validation panel
// still checks the ones that slip through (a self-reference, a cycle, an option that was deleted).

type Op = VisibleWhen["op"];

function opsFor(target: FormField | undefined): { value: string; label: string }[] {
  switch (target?.type) {
    case "toggle":
    case "checkbox":
      return [
        { value: "checked", label: "is on" },
        { value: "off", label: "is off" },
      ];
    case "counter":
    case "number":
    case "rating":
      return [
        { value: "gt", label: "is greater than" },
        { value: "equals", label: "equals" },
      ];
    default:
      return [{ value: "equals", label: "equals" }];
  }
}

const opKey = (w: VisibleWhen): string => (w.op === "equals" && w.value === false ? "off" : w.op);

function build(target: FormField, op: string, value?: string | number | boolean): VisibleWhen {
  if (op === "checked") return { fieldKey: target.key, op: "checked" };
  if (op === "off") return { fieldKey: target.key, op: "equals", value: false };
  if (op === "gt") return { fieldKey: target.key, op: "gt", value: typeof value === "number" ? value : 0 };
  const first = target.options?.[0]?.value;
  return { fieldKey: target.key, op: "equals", value: value !== undefined && typeof value !== "boolean" ? value : (first ?? (NUMERIC.has(target.type) ? 0 : "")) };
}

const NUMERIC = new Set(["counter", "number", "rating"]);

export function ConditionEditor({ field }: { field: FormField }) {
  const { form, update } = useBuilder();
  // A condition can wait on a simple answer only: not a system picker, a photo/sequence/grid, or anything inside a per-team repeating group (its values are per slot).
  const candidates = useMemo(() => {
    const inRepeat = new Set(form.sections.flatMap((s) => s.fields.filter((f) => repeatGroupOf(s, f)).map((f) => f.id)));
    return allFormFields(form).filter((f) => f.id !== field.id && !isSystemField(f) && f.type !== "image" && f.type !== "sequence" && f.type !== "matrix" && !inRepeat.has(f.id));
  }, [form, field.id]);
  const when = field.visibleWhen;
  const target = when ? allFormFields(form).find((f) => f.key === when.fieldKey) : undefined;
  const set = (next: VisibleWhen | undefined) => update((f) => updateField(f, field.id, (x) => (next ? { ...x, visibleWhen: next } : { ...x, visibleWhen: undefined })), `cond:${field.id}`);

  return (
    <div className="flex flex-col gap-3">
      <SelectRow
        label="Show this field"
        value={when ? "when" : "always"}
        onChange={(v) => {
          if (v === "when") {
            const first = candidates[0];
            if (first) set(build(first, opsFor(first)[0].value));
          } else set(undefined);
        }}
        options={[
          { value: "always", label: "Always" },
          { value: "when", label: "Only when another field…" },
        ]}
        hint={candidates.length === 0 && !when ? "Add another field first: a condition needs one to depend on." : "A hidden field isn't scored, isn't required and isn't counted in stats."}
        disabled={candidates.length === 0 && !when}
      />
      {when && (
        <>
          <SelectRow
            label="…this field"
            value={when.fieldKey}
            onChange={(key) => {
              const next = candidates.find((c) => c.key === key);
              if (next) set(build(next, opsFor(next)[0].value));
            }}
            options={[
              ...(target ? [] : [{ value: when.fieldKey, label: `${when.fieldKey} (missing)` }]),
              ...candidates.map((c) => ({ value: c.key, label: c.label })),
            ]}
          />
          <SelectRow
            label="…condition"
            value={opKey(when)}
            onChange={(op) => target && op && set(build(target, op, "value" in when ? when.value : undefined))}
            options={opsFor(target)}
          />
          {when.op === "gt" && <NumberRow label="…this number" value={when.value} onChange={(v) => target && set(build(target, "gt", v ?? 0))} />}
          {when.op === "equals" && typeof when.value !== "boolean" && (target?.type === "select" || target?.type === "radio") && (
            <SelectRow label="…this option" value={String(when.value)} onChange={(v) => target && v !== undefined && set(build(target, "equals", v))} options={(target.options ?? []).map((o) => ({ value: o.value, label: o.label }))} />
          )}
          {when.op === "equals" && typeof when.value !== "boolean" && target && NUMERIC.has(target.type) && (
            <NumberRow label="…this number" value={Number(when.value)} onChange={(v) => set(build(target, "equals", v ?? 0))} />
          )}
          {when.op === "equals" && typeof when.value !== "boolean" && (!target || target.type === "text" || target.type === "textarea") && (
            <TextRow label="…this text" value={String(when.value)} onChange={(v) => target && set(build(target, "equals", v))} />
          )}
        </>
      )}
    </div>
  );
}

export type { Op };
