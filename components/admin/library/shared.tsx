"use client";

import { cn } from "@/lib/utils";

/** The glass-styled native select used inside the manual-entry dialogs (accessible, and well-behaved inside a dialog). */
export const selectClass =
  "h-11 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-3 text-sm text-[var(--foreground)] outline-none transition-shadow duration-300 focus:border-transparent focus:shadow-[0_0_0_3px_rgba(var(--glow),0.25),0_0_24px_2px_rgba(var(--glow),0.2)] [&>option]:bg-[#1b1b26] [&>option]:text-white";

export function FieldError({ children, className }: { children?: string | null; className?: string }) {
  if (!children) return null;
  return (
    <p role="alert" className={cn("mt-1.5 text-xs text-red-300", className)}>
      {children}
    </p>
  );
}

export function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <ul className="flex flex-col gap-1 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs text-amber-200">
      {warnings.map((w) => (
        <li key={w}>⚠ {w}</li>
      ))}
    </ul>
  );
}

export const MATCH_TYPE_OPTIONS = [
  { value: "P", label: "P — Practice" },
  { value: "Q", label: "Q — Qualification" },
  { value: "F", label: "F — Finals" },
];
