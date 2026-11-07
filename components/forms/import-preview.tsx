"use client";

import { AlertTriangle, CheckCircle2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { summarizeForm, type ImportedDraft } from "@/lib/forms/create";

// P23: the preview shown after a form file is checked and before anything is created: what will be made (a draft custom form with these categories and
// fields), what was removed or fixed on the way in, any warnings, or the errors that stopped it. When the only problem is duplicate ids or keys, the file can
// be fixed automatically (the later duplicate is renamed) instead of refused.

export function ImportPreview({ result, onFix, onBack }: { result: ImportedDraft; onFix: () => void; onBack: () => void }) {
  if (!result.ok) {
    return (
      <div className="flex flex-col gap-3" data-testid="import-preview" data-state="refused">
        <div role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200">
          <p className="mb-1 flex items-center gap-2 font-semibold">
            <AlertTriangle className="h-4 w-4" /> This file can&apos;t be imported
          </p>
          <ul className="list-disc pl-5">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </div>
        <div className="flex flex-wrap gap-2">
          {result.repairable && (
            <Button variant="glass" className="gap-2" onClick={onFix}>
              <Wrench className="h-4 w-4" /> Fix automatically
            </Button>
          )}
          <Button variant="ghost" onClick={onBack}>
            Choose another file
          </Button>
        </div>
        {result.repairable && <p className="text-xs text-[var(--muted-foreground)]">Only duplicate ids or keys are wrong. Fixing renames the later duplicate (a number is added to its key) and changes nothing else.</p>}
      </div>
    );
  }

  const s = summarizeForm(result.form);
  return (
    <div className="flex flex-col gap-3" data-testid="import-preview" data-state="ok">
      <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-3 text-sm">
        <p className="mb-1 flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-300" /> This will create one draft form
        </p>
        <p>
          <strong>{s.name}</strong>: a custom form with {s.categories.length} categories and {s.fieldCount} fields. It stays a draft: scouts don&apos;t see it until you publish it and make it active.
        </p>
      </div>
      <ul className="grid gap-1 text-xs sm:grid-cols-2" aria-label="Categories to create">
        {s.categories.map((c, i) => (
          <li key={`${c.title}-${i}`} className="flex items-center justify-between rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5">
            <span>{c.title}</span>
            <span className="text-[var(--muted-foreground)]">{c.fields} fields</span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-[var(--muted-foreground)]">
        {s.scoringEnabled ? `Scores: ${s.scoringFields} scoring field${s.scoringFields === 1 ? "" : "s"}.` : "Doesn't score."} {s.conditions > 0 && `${s.conditions} conditional field${s.conditions === 1 ? "" : "s"}. `}
        {s.aliases > 0 && `${s.aliases} old key name${s.aliases === 1 ? "" : "s"} (aliases). `}
        {s.customPhases.length > 0 && `Custom phases: ${s.customPhases.join(", ")}.`}
      </p>
      {result.changes.length > 0 && (
        <ul className="list-disc rounded-2xl border border-sky-400/30 bg-sky-500/10 py-2 pl-7 pr-3 text-xs" aria-label="What was changed on the way in">
          {result.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      {result.warnings.length > 0 && (
        <ul className="list-disc rounded-2xl border border-amber-400/30 bg-amber-500/10 py-2 pl-7 pr-3 text-xs" aria-label="Warnings">
          {result.warnings.map((w, i) => (
            <li key={i}>{w}</li>
          ))}
        </ul>
      )}
      <Button variant="ghost" size="sm" className="self-start" onClick={onBack}>
        Choose another file
      </Button>
    </div>
  );
}
