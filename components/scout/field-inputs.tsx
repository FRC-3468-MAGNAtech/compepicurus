"use client";

import type { ReactNode } from "react";
import { Star } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { motion } from "framer-motion";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { springSnappy } from "@/lib/motion";
import type { FieldOption } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P21: the input controls for the field types BIOBUZZ doesn't use (number, select, radio, rating), in the same glass/bouncy style as the
// toggle, counter and checkbox tiles.

export function FieldLabel({ htmlFor, label, required, helpText, icon, tip }: { htmlFor?: string; label: string; required?: boolean; helpText?: string; icon?: ReactNode; tip?: string }) {
  return (
    <div className="mb-1.5">
      <Label htmlFor={htmlFor} className="mb-0 inline-flex items-center gap-1.5">
        {icon}
        {label}
        {required && (
          <span className="ml-1 text-red-300" aria-hidden>
            *
          </span>
        )}
        {required && <span className="sr-only"> (required)</span>}
      </Label>
      {tip && <FieldTip label={label} tip={tip} />}
      {helpText && <p className="mt-0.5 text-xs text-[var(--muted-foreground)]">{helpText}</p>}
    </div>
  );
}

export function NumberField({
  id,
  value,
  min,
  max,
  step,
  decimals,
  disabled,
  invalid,
  placeholder,
  onChange,
}: {
  id: string;
  value: number | string;
  min?: number;
  max?: number;
  step?: number;
  decimals?: number;
  disabled?: boolean;
  invalid?: boolean;
  placeholder?: string;
  onChange: (value: number | string) => void;
}) {
  return (
    <Input
      id={id}
      type="number"
      inputMode={decimals ? "decimal" : "numeric"}
      value={value}
      min={min}
      max={max}
      step={step ?? (decimals ? 1 / 10 ** decimals : 1)}
      disabled={disabled}
      placeholder={placeholder}
      aria-invalid={invalid || undefined}
      onChange={(e) => onChange(e.target.value === "" ? "" : Number(e.target.value))}
    />
  );
}

export function SelectField({
  id,
  value,
  options,
  disabled,
  placeholder = "Choose…",
  onChange,
}: {
  id: string;
  value: string;
  options: FieldOption[];
  disabled?: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const chosen = options.find((o) => o.value === value);
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} className="h-12">
        <SelectValue>{chosen ? chosen.label : <span className="text-[var(--muted-foreground)]">{placeholder}</span>}</SelectValue>
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
            {o.points !== undefined && o.points !== 0 ? <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">{o.points} pts</span> : null}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** One-of-N as big touch tiles (a radio group): the chosen one takes the theme gradient. */
export function RadioTiles({ label, value, options, disabled, onChange }: { label: string; value: string; options: FieldOption[]; disabled?: boolean; onChange: (value: string) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((o) => {
        const checked = o.value === value;
        return (
          <motion.button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled}
            whileTap={disabled ? undefined : { scale: 0.96 }}
            transition={springSnappy}
            onClick={() => !disabled && onChange(o.value)}
            className={cn(
              "flex min-h-12 items-center gap-2 rounded-2xl border px-4 py-3 text-sm font-medium transition-colors duration-200",
              checked ? "border-transparent text-[var(--color-primary-foreground)]" : "glass-card border-[var(--glass-border)] text-[var(--muted-foreground)]",
              disabled && "cursor-not-allowed opacity-60"
            )}
            style={checked ? { background: "var(--theme-gradient)" } : undefined}
          >
            {o.label}
            {o.points !== undefined && o.points !== 0 && <span className="text-xs opacity-80">+{o.points}</span>}
          </motion.button>
        );
      })}
    </div>
  );
}

/** 1..scale stars; tapping the current rating clears it. */
export function RatingStars({ label, value, scale, disabled, onChange }: { label: string; value: number; scale: number; disabled?: boolean; onChange: (value: number) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
      {Array.from({ length: scale }, (_, i) => i + 1).map((n) => {
        const on = n <= value;
        return (
          <motion.button
            key={n}
            type="button"
            role="radio"
            aria-checked={n === value}
            aria-label={`${n} of ${scale}`}
            disabled={disabled}
            whileTap={disabled ? undefined : { scale: 0.88 }}
            transition={springSnappy}
            onClick={() => !disabled && onChange(n === value ? 0 : n)}
            className={cn("flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors", on ? "border-transparent text-[var(--color-primary-foreground)]" : "glass-card border-[var(--glass-border)] text-[var(--muted-foreground)]", disabled && "cursor-not-allowed opacity-60")}
            style={on ? { background: "var(--theme-gradient)" } : undefined}
          >
            <Star className={cn("h-5 w-5", on && "fill-current")} />
          </motion.button>
        );
      })}
    </div>
  );
}

/** P22: a field's scouting tip, a small info popover beside the label (hover, focus or tap). */
export function FieldTip({ label, tip }: { label: string; tip: string }) {
  return (
    <InfoTip label={`Tip: ${label}`} align="start" className="ml-1 align-middle">
      {tip}
    </InfoTip>
  );
}
