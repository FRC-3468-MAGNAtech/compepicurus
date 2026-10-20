"use client";

import { useState } from "react";
import { AlertTriangle, Ban, CheckCircle2, X } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FLAG_RULES_BY_ID } from "@/lib/analytics/flags";
import { formatMatch } from "@/lib/analytics/game-schema";
import type { ManualFlagReason, ScoutEntry } from "@/lib/scout-entries";

const MANUAL_FLAG_REASONS: ManualFlagReason[] = [
  "No teleop score",
  "No auto score",
  "Unrealistic scoring",
  "Wrong team scouted",
  "Scout started late",
  "Scout left early",
  "Duplicate entry",
  "Other",
];

export function ConfigModal({
  entry,
  open,
  onOpenChange,
  onDismissAutoFlags,
  onAddManualFlag,
  onRemoveManualFlag,
  onToggleExclude,
}: {
  entry: ScoutEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onDismissAutoFlags: (entryId: string) => void;
  onAddManualFlag: (entryId: string, reason: ManualFlagReason, note?: string) => void;
  onRemoveManualFlag: (entryId: string, flagId: string) => void;
  onToggleExclude: (entryId: string) => void;
}) {
  const [reason, setReason] = useState<ManualFlagReason>(MANUAL_FLAG_REASONS[0]);
  const [note, setNote] = useState("");

  if (!entry) return null;

  const activeAutoFlags = entry.autoFlags.filter((f) => !f.dismissed);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Config</DialogTitle>
        <DialogDescription>
          Match {formatMatch(entry)} &bull; Team {entry.teamNumber}
        </DialogDescription>

        <div className="mt-5 flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Auto Flags</h3>
            {activeAutoFlags.length === 0 ? (
              <p className="glass-card p-3 text-sm text-[var(--muted-foreground)]">No auto flags.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {activeAutoFlags.map((f) => {
                  const rule = FLAG_RULES_BY_ID[f.ruleId];
                  if (!rule) return null;
                  return (
                    <div
                      key={f.ruleId}
                      className="rounded-xl border border-amber-400/30 bg-amber-500/10 p-3 text-sm text-amber-200"
                    >
                      <div className="flex items-center gap-2 font-semibold">
                        <AlertTriangle className="h-4 w-4 shrink-0" /> {rule.title}
                      </div>
                      <p className="mt-1 text-xs text-amber-200/80">{rule.explanation}</p>
                    </div>
                  );
                })}
                <Button variant="glass" size="sm" className="self-start gap-2" onClick={() => onDismissAutoFlags(entry.id)}>
                  <CheckCircle2 className="h-4 w-4" /> Dismiss Auto Flags
                </Button>
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Manual Flag</h3>
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[180px] flex-1">
                <Select value={reason} onValueChange={(v) => setReason(v as ManualFlagReason)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MANUAL_FLAG_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                size="md"
                onClick={() => {
                  onAddManualFlag(entry.id, reason, reason === "Other" ? note : undefined);
                  setNote("");
                }}
              >
                Add Manual Flag
              </Button>
            </div>
            {reason === "Other" && (
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Short note..." />
            )}
            {entry.manualFlags.length > 0 && (
              <div className="flex flex-col gap-2">
                {entry.manualFlags.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200"
                  >
                    <div>
                      <div className="font-medium">{f.reason}</div>
                      {f.note && <div className="text-xs text-red-200/80">{f.note}</div>}
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveManualFlag(entry.id, f.id)}
                      className="rounded-full p-1.5 text-red-200/70 hover:bg-white/10 hover:text-red-100"
                      aria-label="Remove flag"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Stats Exclusion</h3>
            <p className="text-xs text-[var(--muted-foreground)]">
              Excluded entries stay visible here but will be ignored by stats and averages.
            </p>
            <Button
              variant={entry.excluded ? "glass" : "outline"}
              size="sm"
              className="gap-2 self-start"
              onClick={() => onToggleExclude(entry.id)}
            >
              <Ban className="h-4 w-4" /> {entry.excluded ? "Include In Stats" : "Exclude From Stats"}
            </Button>
          </section>

          <Button size="lg" className="mt-1" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
