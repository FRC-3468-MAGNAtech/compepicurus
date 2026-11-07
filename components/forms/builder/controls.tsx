"use client";

import { useId, useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Input, Label, Textarea } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

// P22: the small labelled controls the builder's inspector is made of, so each property is one line of JSX. They're all controlled, 44px-ish
// touch targets (the app's inputs), and use the shared glass inputs/selects (high-opacity backing, legible in every theme).

export function Row({ label, hint, htmlFor, children, className }: { label: string; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <Label htmlFor={htmlFor} className="mb-0 text-xs">
        {label}
      </Label>
      {children}
      {hint && <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">{hint}</p>}
    </div>
  );
}

export function TextRow({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
  hint,
  multiline,
  invalid,
  disabled,
  mono,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  maxLength?: number;
  hint?: ReactNode;
  multiline?: boolean;
  invalid?: boolean;
  disabled?: boolean;
  mono?: boolean;
}) {
  const id = useId();
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      {multiline ? (
        <Textarea id={id} rows={3} value={value} maxLength={maxLength} placeholder={placeholder} disabled={disabled} aria-invalid={invalid || undefined} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input id={id} value={value} maxLength={maxLength} placeholder={placeholder} disabled={disabled} aria-invalid={invalid || undefined} className={mono ? "font-mono text-sm" : undefined} onChange={(e) => onChange(e.target.value)} />
      )}
    </Row>
  );
}

/** A number that can be empty (undefined): an empty box clears the setting. */
export function NumberRow({
  label,
  value,
  onChange,
  min,
  max,
  step,
  hint,
  placeholder,
  disabled,
}: {
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: ReactNode;
  placeholder?: string;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        min={min}
        max={max}
        step={step ?? "any"}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") return onChange(undefined);
          const n = Number(raw);
          if (Number.isFinite(n)) onChange(n);
        }}
      />
    </Row>
  );
}

export function SwitchRow({ label, hint, checked, onChange, disabled }: { label: string; hint?: ReactNode; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <Label htmlFor={id} className="mb-0 text-sm">
          {label}
        </Label>
        {hint && <p className="text-[11px] leading-snug text-[var(--muted-foreground)]">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}

const NONE = "__none__";

export function SelectRow<T extends string>({
  label,
  value,
  onChange,
  options,
  hint,
  allowNone,
  noneLabel = "None",
  disabled,
}: {
  label: string;
  value: T | undefined;
  onChange: (value: T | undefined) => void;
  options: { value: T; label: string }[];
  hint?: ReactNode;
  /** Adds a first "None" choice that sets the value to undefined. */
  allowNone?: boolean;
  noneLabel?: string;
  disabled?: boolean;
}) {
  const id = useId();
  const chosen = options.find((o) => o.value === value);
  return (
    <Row label={label} hint={hint} htmlFor={id}>
      <Select value={value ?? (allowNone ? NONE : "")} disabled={disabled} onValueChange={(v) => onChange(v === NONE ? undefined : (v as T))}>
        <SelectTrigger id={id}>
          <SelectValue>{chosen ? chosen.label : allowNone ? noneLabel : (value ?? "Choose…")}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE}>{noneLabel}</SelectItem>}
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Row>
  );
}

/** A collapsible group of controls (the inspector's Basics / Scoring / Analytics …). */
export function Group({ title, children, defaultOpen = true, badge }: { title: string; children: ReactNode; defaultOpen?: boolean; badge?: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className="rounded-2xl border border-[var(--glass-border)] bg-white/[0.03]">
      <button type="button" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)} className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm font-semibold">
        <span className="flex items-center gap-2">
          {title}
          {badge}
        </span>
        <ChevronDown className={cn("h-4 w-4 text-[var(--muted-foreground)] transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div id={id} className="flex flex-col gap-3 border-t border-[var(--glass-border)] p-3">
          {children}
        </div>
      )}
    </section>
  );
}
