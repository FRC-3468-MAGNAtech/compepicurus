"use client";

import { useState } from "react";
import { AlertTriangle, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DiffView } from "@/components/forms/builder/diff-view";
import { TextRow } from "@/components/forms/builder/controls";
import type { FormDiff } from "@/lib/forms/diff";
import type { FormIssue } from "@/lib/forms/validate";

// P22: the publish confirmation. Shows what this version changes against the last published one (or the built-in), refuses while there are blocking
// problems, and when the change affects scores or data and the form already has entries, says how many and points at the Rescore tool and requires
// an explicit tick. Publishing never rewrites old entries: they keep the version they were scouted with; "Rescore" is the separate, explicit step.

export function PublishDialog({
  open,
  onOpenChange,
  formName,
  nextVersion,
  baseLabel,
  diff,
  errors,
  entryCount,
  busy,
  error,
  onPublish,
  onOpenRescore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  formName: string;
  nextVersion: number;
  /** What the diff is against ("version 3" or "the built-in"). */
  baseLabel: string;
  diff: FormDiff;
  errors: FormIssue[];
  entryCount: number;
  busy: boolean;
  error: string | null;
  onPublish: (note: string) => void;
  onOpenRescore?: () => void;
}) {
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const affects = diff.impact.scores || diff.impact.data;
  const needsConfirm = affects && entryCount > 0;
  const blocked = errors.length > 0 || diff.empty || (needsConfirm && !confirmed) || busy;

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="w-[min(94vw,640px)] max-h-[88vh] overflow-y-auto">
        <DialogTitle>Publish “{formName}” as version {nextVersion}</DialogTitle>
        <DialogDescription>Scouts use the new version from their next load. Entries already saved keep the version they were scouted with.</DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          {errors.length > 0 && (
            <div role="alert" className="rounded-2xl border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-200" data-testid="publish-blocked">
              <strong>Fix these before publishing:</strong>
              <ul className="mt-1 list-disc pl-5">
                {errors.slice(0, 6).map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
              {errors.length > 6 && <p className="mt-1 text-xs">…and {errors.length - 6} more (see Problems).</p>}
            </div>
          )}

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">What changes (from {baseLabel})</h3>
            <DiffView diff={diff} emptyText="Nothing has changed since the last published version." />
          </section>

          {needsConfirm && (
            <div className="flex flex-col gap-2 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-3 text-sm" data-testid="publish-affected">
              <p className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />
                <span>
                  <strong>{entryCount} existing {entryCount === 1 ? "entry uses" : "entries use"} this form.</strong> This change affects {diff.impact.scores && diff.impact.data ? "scores and data" : diff.impact.scores ? "scores" : "data"}. Old entries are not rewritten:
                  {diff.impact.scores ? " use the Rescore tool to score them with the new rules." : " they keep their stored values, and analytics shows a blank where the old version had no value."}
                </span>
              </p>
              {onOpenRescore && diff.impact.scores && (
                <Button variant="glass" size="sm" className="self-start" onClick={onOpenRescore}>
                  Open the Rescore tool
                </Button>
              )}
              <label className="flex min-h-11 items-start gap-2">
                <input type="checkbox" className="mt-1 h-4 w-4 accent-[var(--color-primary)]" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>I understand, and I&apos;ll rescore if I need to.</span>
              </label>
            </div>
          )}

          <TextRow label="What changed (optional note)" multiline value={note} maxLength={300} onChange={setNote} placeholder="e.g. Raised Hive points to match the new manual" hint="Shown in the version history." />
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button className="gap-2" disabled={blocked} onClick={() => onPublish(note)}>
              <Rocket className="h-4 w-4" /> {busy ? "Publishing…" : `Publish version ${nextVersion}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
