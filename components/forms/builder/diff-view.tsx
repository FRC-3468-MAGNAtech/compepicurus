"use client";

import { AlertTriangle, Minus, Pencil, Plus, Move } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { ChangeKind, FormDiff, Impact } from "@/lib/forms/diff";
import { cn } from "@/lib/utils";

// P22: renders a FormDiff: what was added, removed and changed between two versions (or a draft and its base, or an override and its built-in). A
// change that would score existing entries differently or change their data shape is marked "affects scores" / "affects data".

const KIND: Record<ChangeKind, { icon: typeof Plus; label: string; tone: string }> = {
  added: { icon: Plus, label: "Added", tone: "text-emerald-300" },
  removed: { icon: Minus, label: "Removed", tone: "text-red-300" },
  changed: { icon: Pencil, label: "Changed", tone: "text-amber-300" },
  moved: { icon: Move, label: "Moved", tone: "text-sky-300" },
};

export function ImpactBadges({ impact }: { impact: Impact }) {
  if (!impact.scores && !impact.data) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {impact.scores && (
        <Badge variant="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> affects scores
        </Badge>
      )}
      {impact.data && (
        <Badge variant="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> affects data
        </Badge>
      )}
    </span>
  );
}

function Item({ kind, title, sub, details, impact }: { kind: ChangeKind; title: string; sub?: string; details: string[]; impact: Impact }) {
  const { icon: Icon, label, tone } = KIND[kind];
  return (
    <li className={cn("flex flex-col gap-1 rounded-xl border px-3 py-2 text-sm", impact.scores || impact.data ? "border-amber-400/40 bg-amber-500/[0.07]" : "border-[var(--glass-border)] bg-white/[0.03]")}>
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 text-xs font-semibold", tone)}>
          <Icon className="h-3.5 w-3.5" /> {label}
        </span>
        <span className="font-medium">{title}</span>
        {sub && <span className="text-xs text-[var(--muted-foreground)]">{sub}</span>}
        <ImpactBadges impact={impact} />
      </div>
      <ul className="list-disc pl-5 text-xs text-[var(--muted-foreground)]">
        {details.map((d, i) => (
          <li key={i}>{d}</li>
        ))}
      </ul>
    </li>
  );
}

export function DiffView({ diff, emptyText = "No differences." }: { diff: FormDiff; emptyText?: string }) {
  if (diff.empty) return <p className="text-sm text-[var(--muted-foreground)]" data-testid="diff-empty">{emptyText}</p>;
  return (
    <div className="flex flex-col gap-3" data-testid="diff-view">
      <p className="text-xs text-[var(--muted-foreground)]">
        {diff.counts.added} added, {diff.counts.removed} removed, {diff.counts.changed} changed.
        {(diff.impact.scores || diff.impact.data) && " Highlighted changes would score existing entries differently or change their data."}
      </p>
      {diff.form.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          <Item kind="changed" title="Form" details={diff.form} impact={{ scores: diff.form.some((d) => d.startsWith("Scoring turned")), data: diff.form.some((d) => d.startsWith("Scoring turned")) }} />
        </ul>
      )}
      {diff.sections.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Categories</h4>
          <ul className="flex flex-col gap-1.5">
            {diff.sections.map((s) => (
              <Item key={`${s.id}-${s.kind}`} kind={s.kind} title={s.title} details={s.details} impact={s.impact} />
            ))}
          </ul>
        </section>
      )}
      {diff.fields.length > 0 && (
        <section className="flex flex-col gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Fields</h4>
          <ul className="flex flex-col gap-1.5">
            {diff.fields.map((f) => (
              <Item key={`${f.id}-${f.kind}`} kind={f.kind} title={f.label} sub={`${f.section} · ${f.key}`} details={f.details} impact={f.impact} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
