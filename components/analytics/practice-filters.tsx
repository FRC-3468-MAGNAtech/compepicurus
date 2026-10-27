"use client";

import { GlassPanel } from "@/components/ui/glass-panel";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type PracticeModeFilter = "all" | "trial" | "competitive";
export type PracticeSourceFilter = "all" | "practice" | "live";

const MODE_LABELS: Record<PracticeModeFilter, string> = { all: "Both", trial: "Trial", competitive: "Competitive" };
const SOURCE_LABELS: Record<PracticeSourceFilter, string> = { all: "Both", practice: "Practice", live: "Live" };

/** Shown only under Match Analytics' "Practice Scouted Matches" toggle (P9). */
export function PracticeFilters({
  mode,
  onModeChange,
  source,
  onSourceChange,
  events,
  selectedEventCodes,
  onToggleEvent,
}: {
  mode: PracticeModeFilter;
  onModeChange: (v: PracticeModeFilter) => void;
  source: PracticeSourceFilter;
  onSourceChange: (v: PracticeSourceFilter) => void;
  events: { code: string; name: string }[];
  /** Empty = every event. */
  selectedEventCodes: string[];
  onToggleEvent: (code: string) => void;
}) {
  return (
    <GlassPanel className="flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Mode</span>
        <Select value={mode} onValueChange={(v) => onModeChange(v as PracticeModeFilter)}>
          <SelectTrigger className="w-36">
            <SelectValue>{MODE_LABELS[mode]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(MODE_LABELS) as PracticeModeFilter[]).map((m) => (
              <SelectItem key={m} value={m}>
                {MODE_LABELS[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Source</span>
        <Select value={source} onValueChange={(v) => onSourceChange(v as PracticeSourceFilter)}>
          <SelectTrigger className="w-32">
            <SelectValue>{SOURCE_LABELS[source]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {(Object.keys(SOURCE_LABELS) as PracticeSourceFilter[]).map((s) => (
              <SelectItem key={s} value={s}>
                {SOURCE_LABELS[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {events.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Event</span>
          {events.map((e) => {
            const active = selectedEventCodes.includes(e.code);
            return (
              <button key={e.code} type="button" onClick={() => onToggleEvent(e.code)}>
                <Badge
                  variant={active ? "accent" : "outline"}
                  className={active ? "" : "text-[var(--muted-foreground)] opacity-70"}
                >
                  {e.name}
                </Badge>
              </button>
            );
          })}
          {selectedEventCodes.length === 0 && (
            <span className="text-xs text-[var(--muted-foreground)]">(none selected = all events)</span>
          )}
        </div>
      )}
    </GlassPanel>
  );
}
