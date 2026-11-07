"use client";

import { useMemo, useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { buildGameSchema, csvHeaderFor, type AnalyticsColumn } from "@/lib/analytics/game-schema";
import { formFieldMeta } from "@/lib/forms/meta";
import { phaseLabel } from "@/lib/forms/types";
import type { AggregateKind, Form, FormField } from "@/lib/forms/types";

// P22: what this form will become in Match Analytics, team stats and the CSV: the exact three-tier header the table will show (the same
// `buildGameSchema` the table itself is built from, so this can't drift), the CSV header row, and the per-field team stats. Nothing here is a
// separate description of the form: if it's in the form, it's here.

const AGG_LABEL: Record<AggregateKind, string> = { sum: "total", avg: "average per match", rate: "share of matches", last: "most recent", list: "list of values" };

export function defaultAggregate(f: Pick<FormField, "type">): AggregateKind {
  switch (f.type) {
    case "counter":
    case "number":
    case "rating":
      return "avg";
    case "text":
    case "textarea":
      return "list";
    case "select":
    case "radio":
      return "last";
    default:
      return "rate";
  }
}

type Span = { label: string; span: number };

/** Consecutive columns with the same label merge into one header cell (the three-tier header's rowspans). */
function spans(cols: AnalyticsColumn[], pick: (c: AnalyticsColumn) => string, within?: (c: AnalyticsColumn) => string): Span[] {
  const out: Span[] = [];
  let prevKey = "";
  for (const c of cols) {
    const key = `${within ? within(c) : ""}|${pick(c)}`;
    if (out.length > 0 && key === prevKey) out[out.length - 1].span++;
    else out.push({ label: pick(c), span: 1 });
    prevKey = key;
  }
  return out;
}

export function AnalyticsPreview({ form }: { form: Form }) {
  const [copied, setCopied] = useState(false);
  const columns = useMemo(() => buildGameSchema(form).columns.filter((c) => c.type !== "actions"), [form]);
  const csvHeader = useMemo(() => columns.map(csvHeaderFor), [columns]);
  const stats = useMemo(() => formFieldMeta(form).filter((m) => m.field.analytics?.include !== false), [form]);
  const phaseRow = spans(columns, (c) => c.phase);
  const categoryRow = spans(columns, (c) => c.category, (c) => c.phase);

  return (
    <div className="flex flex-col gap-5" data-testid="analytics-preview">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Match Analytics header</h3>
        <p className="text-xs text-[var(--muted-foreground)]">{columns.length} columns, built from this form automatically. The same table, CSV export and CSV import use them.</p>
        <div className="overflow-x-auto rounded-2xl border border-[var(--glass-border)]">
          <table className="min-w-full border-collapse text-xs">
            <thead>
              <tr className="bg-white/[0.05]">
                {phaseRow.map((s, i) => (
                  <th key={i} colSpan={s.span} className="border-b border-r border-[var(--glass-border)] px-2 py-1.5 text-center font-semibold last:border-r-0">
                    {s.label}
                  </th>
                ))}
              </tr>
              <tr className="bg-white/[0.03]">
                {categoryRow.map((s, i) => (
                  <th key={i} colSpan={s.span} className="border-b border-r border-[var(--glass-border)] px-2 py-1 text-center font-medium text-[var(--muted-foreground)] last:border-r-0">
                    {s.label}
                  </th>
                ))}
              </tr>
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className="whitespace-nowrap border-r border-[var(--glass-border)] px-2 py-1.5 text-left font-medium last:border-r-0">
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">CSV header row</h3>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(csvHeader.join(","));
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              } catch {
                /* clipboard unavailable: the text is selectable below */
              }
            }}
          >
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {copied ? "Copied" : "Copy"}
          </Button>
        </div>
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-2xl border border-[var(--glass-border)] bg-white/[0.04] p-3 font-mono text-[11px] leading-relaxed" data-testid="csv-header">
          {csvHeader.join(",")}
        </pre>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-semibold">Team stats</h3>
        <p className="text-xs text-[var(--muted-foreground)]">Per team, across their entries: the score average and spread, and for each field below.</p>
        {stats.length === 0 ? (
          <p className="text-xs text-[var(--muted-foreground)]">No fields are included in analytics.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {stats.map((m) => (
              <li key={m.field.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-xl border border-[var(--glass-border)] px-2.5 py-1.5 text-xs">
                <span className="font-medium">{m.field.analytics?.label ?? m.field.label}</span>
                <span className="text-[var(--muted-foreground)]">{AGG_LABEL[m.field.analytics?.aggregate ?? defaultAggregate(m.field)]}</span>
                {m.scored && <Badge variant="outline">scores in {phaseLabel(form, m.phase)}</Badge>}
                {m.field.statRoles?.map((r) => (
                  <Badge key={r} variant="outline">
                    {r}
                  </Badge>
                ))}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
