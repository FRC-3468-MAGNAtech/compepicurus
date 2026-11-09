"use client";

import type { ReactNode } from "react";
import { Check, Star } from "lucide-react";
import { InfoTip } from "@/components/ui/info-tip";
import { motion } from "framer-motion";
import { Input, Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { springSnappy } from "@/lib/motion";
import type { FieldOption } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P21: the input controls for the field types BIOBUZZ doesn't use (number, select, radio, rating), in the same glass/bouncy style as the
// toggle, counter and checkbox tiles.

export function FieldLabel({ htmlFor, label, required, helpText, icon, tip, extra }: { htmlFor?: string; label: string; required?: boolean; helpText?: string; icon?: ReactNode; tip?: string; /** P27: beside the label (the plan-difference icon) */ extra?: ReactNode }) {
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
      {extra}
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

// --- P27: slider, step sequence, checkbox grid ---------------------------------------------------------------------------------

/** An integer range with a big thumb, optional tick marks and end labels (a native range input, so it works with touch, keyboard and screen readers). */
export function SliderField({
  id,
  label,
  value,
  min,
  max,
  step,
  ticks,
  endLabels,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  ticks?: boolean;
  endLabels?: { min?: string; max?: string };
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const count = Math.floor((max - min) / step) + 1;
  const marks = ticks && count > 1 && count <= 21 ? Array.from({ length: count }, (_, i) => min + i * step) : [];
  const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="flex flex-col gap-1.5" data-testid={`slider-${id}`}>
      <div className="flex items-center gap-3">
        <input
          id={id}
          type="range"
          className="field-slider min-h-11 flex-1"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={label}
          aria-valuetext={`${value} of ${max}`}
          style={{ ["--slider-fill" as string]: `${pct}%` }}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        <output htmlFor={id} className="w-8 shrink-0 text-center text-lg font-semibold tabular-nums" data-testid="slider-value">
          {value}
        </output>
      </div>
      {marks.length > 0 && (
        <div className="flex justify-between px-2 text-[10px] tabular-nums text-[var(--muted-foreground)]" aria-hidden>
          {marks.map((m) => (
            <span key={m}>{m}</span>
          ))}
        </div>
      )}
      {(endLabels?.min || endLabels?.max) && (
        <div className="flex justify-between text-xs text-[var(--muted-foreground)]">
          <span>{endLabels?.min}</span>
          <span>{endLabels?.max}</span>
        </div>
      )}
    </div>
  );
}

/** A grid of checkboxes: rows x columns, one boolean per cell (`row_col`); a disabled cell isn't offered. */
export function MatrixField({
  label,
  rows,
  cols,
  disabledCells,
  value,
  disabled,
  onChange,
}: {
  label: string;
  rows: { key: string; label: string }[];
  cols: { key: string; label: string }[];
  disabledCells?: string[];
  value: Record<string, boolean>;
  disabled?: boolean;
  onChange: (value: Record<string, boolean>) => void;
}) {
  const off = new Set(disabledCells ?? []);
  return (
    <div className="glass-card overflow-x-auto p-2" data-testid="matrix-field">
      <table className="w-full border-collapse text-sm" aria-label={label}>
        <thead>
          <tr>
            <th className="px-2 py-1" />
            {cols.map((c) => (
              <th key={c.key} scope="col" className="px-2 py-1 text-center text-xs font-medium text-[var(--muted-foreground)]">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" className="whitespace-nowrap px-2 py-1 text-left font-medium">
                {r.label}
              </th>
              {cols.map((c) => {
                const cell = `${r.key}_${c.key}`;
                if (off.has(cell)) {
                  return (
                    <td key={c.key} className="px-2 py-1 text-center text-[var(--muted-foreground)]" data-cell={cell} data-disabled="true">
                      <span aria-label={`${r.label}, ${c.label}: not available`}>–</span>
                    </td>
                  );
                }
                const on = value[cell] === true;
                return (
                  <td key={c.key} className="px-1 py-0.5 text-center" data-cell={cell}>
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={`${r.label}, ${c.label}`}
                      disabled={disabled}
                      onClick={() => onChange({ ...value, [cell]: !on })}
                      className={cn("mx-auto flex h-11 w-11 items-center justify-center rounded-xl border transition-colors", on ? "border-transparent text-[var(--color-primary-foreground)]" : "glass-card border-[var(--glass-border)]", disabled && "opacity-60")}
                      style={on ? { background: "var(--theme-gradient)" } : undefined}
                    >
                      {on && <Check className="h-5 w-5" />}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
