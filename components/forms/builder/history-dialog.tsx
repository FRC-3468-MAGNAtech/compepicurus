"use client";

import { useEffect, useMemo, useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/forms/builder/diff-view";
import { diffForms } from "@/lib/forms/diff";
import type { FormVersion } from "@/lib/forms/resolve";
import type { FormUsage } from "@/lib/forms/usage";
import type { Form } from "@/lib/forms/types";
import { cn } from "@/lib/utils";

// P22: version history: every published version, newest first (a built-in's original, still in code, at the bottom), how many entries were scouted
// with each, what each one changed from the one before, how it differs from the working copy, and "Restore": which puts that version's content into
// the draft (never straight to scouts: you review it and publish it as a new version).

type Row = { version: number; form: Form; note?: string; by?: string; at?: number; builtin?: boolean };

export function HistoryDialog(props: HistoryProps) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="w-[min(96vw,820px)] max-h-[90vh] overflow-y-auto">
        <HistoryBody {...props} />
      </DialogContent>
    </Dialog>
  );
}

type HistoryProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loadVersions: () => Promise<FormVersion[]>;
  /** The code-defined original, when this form is (an override of) a built-in. */
  builtin: Form | null;
  /** The working copy, to compare against. */
  working: Form;
  usage: FormUsage | undefined;
  nameOf: (uid: string | undefined) => string;
  onRestore: (form: Form) => Promise<void>;
};

/** Mounted only while the dialog is open, so every open starts from a fresh load. */
function HistoryBody({
  onOpenChange,
  loadVersions,
  builtin,
  working,
  usage,
  nameOf,
  onRestore,
}: HistoryProps) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [against, setAgainst] = useState<"previous" | "draft">("previous");
  const [confirm, setConfirm] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    loadVersions()
      .then((versions) => {
        if (!alive) return;
        const list: Row[] = versions.map((v) => ({ version: v.version, form: v.form, note: v.note, by: v.createdBy, at: v.createdAt }));
        if (builtin && !list.some((r) => r.version === builtin.version)) list.push({ version: builtin.version, form: builtin, builtin: true });
        list.sort((a, b) => b.version - a.version);
        setRows(list);
        setPicked(list[0]?.version ?? null);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Couldn't load the version history."));
    return () => {
      alive = false;
    };
  }, [loadVersions, builtin]);

  const selected = rows?.find((r) => r.version === picked) ?? null;
  const previous = useMemo(() => (rows && selected ? rows.find((r) => r.version < selected.version) ?? null : null), [rows, selected]);
  const diff = useMemo(() => {
    if (!selected) return null;
    if (against === "draft") return diffForms(selected.form, working);
    return previous ? diffForms(previous.form, selected.form) : null;
  }, [selected, previous, against, working]);

  return (
    <>
        <DialogTitle className="flex items-center gap-2">
          <History className="h-5 w-5" /> Version history
        </DialogTitle>
        <DialogDescription>Published versions never change. Restoring puts an old version into your draft; publish it to make it the live one.</DialogDescription>

        {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
        {!rows && !error && <div className="glass-card mt-4 h-32 animate-pulse" />}
        {rows && rows.length === 0 && <p className="mt-4 text-sm text-[var(--muted-foreground)]">Nothing has been published yet.</p>}
        {rows && rows.length > 0 && (
          <div className="mt-4 grid gap-4 md:grid-cols-[14rem_1fr]">
            <ul className="flex flex-col gap-1.5" aria-label="Versions">
              {rows.map((r) => (
                <li key={r.version}>
                  <button type="button" aria-pressed={r.version === picked} onClick={() => setPicked(r.version)} className={cn("flex min-h-11 w-full flex-col items-start rounded-xl border px-3 py-2 text-left text-sm", r.version === picked ? "border-[var(--color-primary)] bg-white/[0.08]" : "border-[var(--glass-border)] bg-white/[0.03]")}>
                    <span className="flex items-center gap-2 font-semibold">
                      Version {r.version}
                      {r === rows[0] && !r.builtin && <Badge variant="success">live</Badge>}
                      {r.builtin && <Badge variant="outline">built-in original</Badge>}
                    </span>
                    <span className="text-[11px] text-[var(--muted-foreground)]">
                      {usage?.byVersion.get(r.version) ?? 0} entries
                      {r.at ? ` · ${new Date(r.at).toLocaleDateString()}` : ""}
                      {r.by ? ` · ${nameOf(r.by)}` : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>

            {selected && (
              <div className="flex min-w-0 flex-col gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold">Version {selected.version}</h3>
                  <div className="glass-pill ml-auto inline-flex p-0.5 text-xs" role="group" aria-label="Compare against">
                    <button type="button" aria-pressed={against === "previous"} onClick={() => setAgainst("previous")} className={cn("rounded-full px-3 py-1.5", against === "previous" && "text-[var(--color-primary-foreground)]")} style={against === "previous" ? { background: "var(--theme-gradient)" } : undefined}>
                      vs. the one before
                    </button>
                    <button type="button" aria-pressed={against === "draft"} onClick={() => setAgainst("draft")} className={cn("rounded-full px-3 py-1.5", against === "draft" && "text-[var(--color-primary-foreground)]")} style={against === "draft" ? { background: "var(--theme-gradient)" } : undefined}>
                      vs. my draft
                    </button>
                  </div>
                </div>
                {selected.note && <p className="rounded-xl border border-[var(--glass-border)] bg-white/[0.04] px-3 py-2 text-sm">“{selected.note}”</p>}
                {diff ? (
                  <DiffView diff={diff} emptyText={against === "draft" ? "Your draft is the same as this version." : "No differences from the version before."} />
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">This is the first version, so there is nothing before it to compare with.</p>
                )}
                <div className="flex justify-end">
                  {confirm === selected.version ? (
                    <div className="flex flex-wrap items-center justify-end gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-2 text-sm">
                      <span>Replace your draft with version {selected.version}?</span>
                      <Button variant="ghost" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
                        Cancel
                      </Button>
                      <Button
                        size="sm"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          try {
                            await onRestore(selected.form);
                            setConfirm(null);
                            onOpenChange(false);
                          } catch (e) {
                            setError(e instanceof Error ? e.message : "Couldn't restore that version.");
                          } finally {
                            setBusy(false);
                          }
                        }}
                      >
                        {busy ? "Restoring…" : "Restore into draft"}
                      </Button>
                    </div>
                  ) : (
                    <Button variant="glass" className="gap-2" onClick={() => setConfirm(selected.version)}>
                      <RotateCcw className="h-4 w-4" /> Restore this version
                    </Button>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
    </>
  );
}
