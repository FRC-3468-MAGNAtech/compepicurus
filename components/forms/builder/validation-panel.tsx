"use client";

import { AlertTriangle, CheckCircle2, XCircle } from "lucide-react";
import { useBuilder } from "@/components/forms/builder/context";
import type { FormIssue } from "@/lib/forms/validate";
import { cn } from "@/lib/utils";

// P22: the validation panel: blocking errors (publishing is refused until they're fixed) and warnings (worth a look, never blocking). Clicking an
// issue selects the field or category it's about.

export function ValidationPanel() {
  const { issues, select } = useBuilder();
  const errors = issues.filter((i) => i.severity === "error");
  const warnings = issues.filter((i) => i.severity === "warning");

  const go = (i: FormIssue) => {
    if (i.fieldId) select({ kind: "field", id: i.fieldId });
    else if (i.sectionId) select({ kind: "section", id: i.sectionId });
    else select({ kind: "form" });
  };

  if (issues.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm text-emerald-200" data-testid="validation-clean">
        <CheckCircle2 className="h-4 w-4" /> No problems. This form can be published.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3" data-testid="validation-panel">
      <p className="text-xs text-[var(--muted-foreground)]">
        {errors.length > 0 ? `${errors.length} problem${errors.length === 1 ? "" : "s"} must be fixed before this form can be published.` : "No blocking problems."}
        {warnings.length > 0 && ` ${warnings.length} tip${warnings.length === 1 ? "" : "s"} below are worth a look.`}
      </p>
      <IssueList title="Errors" issues={errors} tone="error" onPick={go} />
      <IssueList title="Tips" issues={warnings} tone="warning" onPick={go} />
    </div>
  );
}

function IssueList({ title, issues, tone, onPick }: { title: string; issues: FormIssue[]; tone: "error" | "warning"; onPick: (i: FormIssue) => void }) {
  if (issues.length === 0) return null;
  const Icon = tone === "error" ? XCircle : AlertTriangle;
  return (
    <section className="flex flex-col gap-1.5">
      <h4 className={cn("text-xs font-semibold uppercase tracking-wide", tone === "error" ? "text-red-300" : "text-amber-300")}>{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {issues.map((i, n) => (
          <li key={`${i.code}-${n}`}>
            <button type="button" onClick={() => onPick(i)} className={cn("flex min-h-11 w-full items-start gap-2 rounded-xl border px-3 py-2 text-left text-sm", tone === "error" ? "border-red-400/30 bg-red-500/10" : "border-amber-400/30 bg-amber-500/10")}>
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "error" ? "text-red-300" : "text-amber-300")} />
              <span>{i.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
