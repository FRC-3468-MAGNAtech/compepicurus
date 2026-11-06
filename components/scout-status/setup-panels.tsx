"use client";

import { useState } from "react";
import { RotateCcw, UserPlus, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { CATEGORY_IDS, STATUS_CATEGORIES, type StatusCategory } from "@/lib/scout-status/categories";
import { clampTarget, type EventSetup, type ScoutDescriptor } from "@/lib/scout-status/compute";
import { SCOUT_STATUS_CONFIG } from "@/lib/scout-status/config";
import { parseRangeText } from "@/lib/scout-status/ranges";
import type { EventSetupView } from "@/lib/scout-status/use-scout-status";
import type { TeamMember } from "@/lib/team-members";
import { cn } from "@/lib/utils";

/** Edits one event's saved setup. The page saves the result. */
export type SetupChange = (eventCode: string, mutate: (setup: EventSetup) => EventSetup) => void;

const catLabel = (id: StatusCategory) => STATUS_CATEGORIES.find((c) => c.id === id)!.label;

function SourceBadge({ source }: { source: "api" | "manual" | "assignments" | "none" }) {
  if (source === "none") return null;
  const label = source === "api" ? "from API" : source === "assignments" ? "from assignments" : "manual";
  return (
    <Badge variant={source === "manual" ? "accent" : "outline"} className="text-[10px]">
      {label}
    </Badge>
  );
}

/** A number box that commits on blur or Enter (so a half-typed value never saves), and shows what is stored while not being edited. */
function NumberBox({ value, placeholder, disabled, label, max, onCommit }: { value: number | null; placeholder?: string; disabled?: boolean; label: string; max?: number; onCommit: (n: number | null) => void }) {
  const stored = value === null ? "" : String(value);
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? stored;
  const commit = () => {
    if (draft === null) return;
    const text = draft.trim();
    setDraft(null);
    if (text === stored) return;
    if (text === "") return onCommit(null);
    const n = Number(text);
    if (Number.isFinite(n)) onCommit(clampTarget(n, max ?? SCOUT_STATUS_CONFIG.MAX_TARGET));
  };
  return (
    <Input
      inputMode="numeric"
      aria-label={label}
      className="h-9 w-20 px-2.5 text-sm"
      value={shown}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, "").slice(0, 3))}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

// ---- 3. Range entry -------------------------------------------------------------------

export function RangeEntry({ view, enabled, canEdit, onChange }: { view: EventSetupView; enabled: ReadonlySet<StatusCategory>; canEdit: boolean; onChange: SetupChange }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {STATUS_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => (
        <RangeField key={`${view.eventCode}-${c.id}`} category={c.id} label={c.label} setupText={view.setup.ranges[c.id] ?? ""} total={view.ctx.matches.filter((m) => m.category === c.id).length} canEdit={canEdit} onCommit={(text) => onChange(view.eventCode, (s) => ({ ...s, ranges: { ...s.ranges, [c.id]: text } }))} />
      ))}
    </div>
  );
}

function RangeField({ category, label, setupText, total, canEdit, onCommit }: { category: StatusCategory; label: string; setupText: string; total: number; canEdit: boolean; onCommit: (text: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? setupText;
  const parsed = parseRangeText(text);
  // The chip reports the saved range's effect: `total` is how many of the category's matches it selects (it updates when the text is committed on blur or Enter).
  const id = `range-${category}`;
  const commit = () => {
    if (draft === null) return;
    setDraft(null);
    if (parseRangeText(draft).errors.length === 0 && draft !== setupText) onCommit(draft.trim());
  };
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={text} disabled={!canEdit} placeholder="blank = all, or 2-4, 8, 10-12" aria-invalid={parsed.errors.length > 0} onChange={(e) => setDraft(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()} />
      {parsed.errors.length > 0 ? (
        <p role="alert" className="mt-1.5 text-xs text-red-300">
          {parsed.errors[0]}
        </p>
      ) : (
        <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">
          {setupText.trim() === "" ? `All ${total} match${total === 1 ? "" : "es"}` : `${total} match${total === 1 ? "" : "es"} selected`}
          {draft !== null && " · press Enter or leave the box to apply"}
          {category === "final" && !parsed.all ? " · overrides which playoff matches are the Finals" : ""}
        </p>
      )}
    </div>
  );
}

// ---- 4. Max match targets ------------------------------------------------------------------

export function MaxTargets({ view, enabled, canEdit, onChange }: { view: EventSetupView; enabled: ReadonlySet<StatusCategory>; canEdit: boolean; onChange: SetupChange }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {STATUS_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => {
        const max = view.maxes[c.id];
        return (
          <div key={c.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-3">
            <span className="min-w-28 flex-1 text-sm font-medium">{c.label}</span>
            <NumberBox label={`Max matches, ${c.label}`} value={max.value} placeholder="?" disabled={!canEdit} onCommit={(n) => onChange(view.eventCode, (s) => ({ ...s, maxOverrides: n === null ? withoutKey(s.maxOverrides, c.id) : { ...s.maxOverrides, [c.id]: n } }))} />
            <SourceBadge source={max.source} />
            {canEdit && max.source === "manual" && view.ctx.hasSchedule && (
              <Button size="sm" variant="ghost" className="gap-1 px-2" onClick={() => onChange(view.eventCode, (s) => ({ ...s, maxOverrides: withoutKey(s.maxOverrides, c.id) }))}>
                <RotateCcw className="h-3 w-3" /> Reset to API
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function withoutKey<T extends Record<string, unknown>>(obj: T, key: string): T {
  const next = { ...obj };
  delete next[key];
  return next;
}

// ---- 5. Individual scout targets --------------------------------------------------------------

export function IndividualTargets({
  views,
  selected,
  scouts,
  members,
  enabled,
  canEdit,
  onChange,
}: {
  views: EventSetupView[];
  /** The event being edited, or null for the read-only summed view across every selected event. */
  selected: EventSetupView | null;
  scouts: ScoutDescriptor[];
  members: TeamMember[];
  enabled: ReadonlySet<StatusCategory>;
  canEdit: boolean;
  onChange: SetupChange;
}) {
  const [adding, setAdding] = useState("");
  const addable = members.filter((m) => !scouts.some((s) => s.uid === m.uid));
  const extras = new Set(views.flatMap((v) => v.setup.extraScouts));

  if (scouts.length === 0 && !selected) return <p className="text-sm text-[var(--muted-foreground)]">No Match Scouts are marked as attending yet. Mark attendance on the Assignments page, or add members by hand.</p>;

  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-2xl border border-[var(--glass-border)]">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
            <tr>
              <th className="sticky left-0 z-10 bg-[#1b1b26] px-3 py-2 font-medium">Scout</th>
              {CATEGORY_IDS.map((c) => (
                <th key={c} className={cn("px-3 py-2 font-medium", !enabled.has(c) && "opacity-40")}>
                  {catLabel(c)}
                </th>
              ))}
              {selected && canEdit && <th className="px-3 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)]">
            {scouts.map((s) => (
              <tr key={s.uid}>
                <td className="sticky left-0 z-10 bg-[#1b1b26] px-3 py-2">
                  <div className="font-medium">{s.name}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">{s.role}</div>
                </td>
                {CATEGORY_IDS.map((c) => {
                  if (!enabled.has(c)) {
                    return (
                      <td key={c} className="px-3 py-2 opacity-40">
                        —
                      </td>
                    );
                  }
                  if (!selected) {
                    // Summed, read-only.
                    const sum = views.reduce<number | null>((acc, v) => {
                      const cell = v.targets.get(s.uid)?.[c];
                      return cell?.value == null ? acc : (acc ?? 0) + cell.value;
                    }, null);
                    return (
                      <td key={c} className="px-3 py-2 tabular-nums">
                        {sum ?? "—"}
                      </td>
                    );
                  }
                  const cell = selected.targets.get(s.uid)?.[c];
                  return (
                    <td key={c} className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <NumberBox label={`${s.name}, ${catLabel(c)} target`} value={cell?.value ?? null} placeholder="—" disabled={!canEdit} max={selected.maxes[c].value ?? undefined} onCommit={(n) => onChange(selected.eventCode, (set) => setIndividual(set, s.uid, c, n))} />
                        <SourceBadge source={cell?.source ?? "none"} />
                        {canEdit && cell?.source === "manual" && (
                          <button type="button" aria-label={`Reset ${s.name}'s ${catLabel(c)} target`} title="Reset to assignments" className="rounded p-1 text-[var(--muted-foreground)] hover:text-[var(--foreground)]" onClick={() => onChange(selected.eventCode, (set) => setIndividual(set, s.uid, c, null))}>
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    </td>
                  );
                })}
                {selected && canEdit && (
                  <td className="px-3 py-2">
                    {selected.setup.extraScouts.includes(s.uid) && (
                      <button type="button" aria-label={`Remove ${s.name} from the targets`} className="rounded p-1 text-[var(--muted-foreground)] hover:text-red-300" onClick={() => onChange(selected.eventCode, (set) => ({ ...set, extraScouts: set.extraScouts.filter((u) => u !== s.uid) }))}>
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected && canEdit && (
        <div className="flex flex-wrap items-center gap-2">
          <select aria-label="Add a team member to the targets" value={adding} onChange={(e) => setAdding(e.target.value)} className="h-10 min-w-48 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-3 text-sm [&>option]:bg-[#1b1b26] [&>option]:text-white">
            <option value="">Add team member…</option>
            {addable.map((m) => (
              <option key={m.uid} value={m.uid}>
                {m.name}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="glass"
            className="gap-1.5"
            disabled={!adding}
            onClick={() => {
              onChange(selected.eventCode, (set) => ({ ...set, extraScouts: set.extraScouts.includes(adding) ? set.extraScouts : [...set.extraScouts, adding] }));
              setAdding("");
            }}
          >
            <UserPlus className="h-3.5 w-3.5" /> Add
          </Button>
          {extras.size > 0 && <span className="text-xs text-[var(--muted-foreground)]">Members added by hand can be removed with the ✕.</span>}
        </div>
      )}
    </div>
  );
}

function setIndividual(setup: EventSetup, uid: string, category: StatusCategory, value: number | null): EventSetup {
  const row = { ...(setup.individual[uid] ?? {}) };
  if (value === null) delete row[category];
  else row[category] = value;
  const individual = { ...setup.individual };
  if (Object.keys(row).length === 0) delete individual[uid];
  else individual[uid] = row;
  return { ...setup, individual };
}
