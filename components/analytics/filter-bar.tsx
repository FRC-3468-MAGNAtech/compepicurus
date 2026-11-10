"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { Checkbox } from "@/components/ui/checkbox";
import { InfoTip } from "@/components/ui/info-tip";
import { Label } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { EventMultiSelect } from "@/components/analytics/event-multiselect";
import { useAnalyticsData, useAnalyticsEntries, useSingleEvent } from "@/lib/analytics/data-context";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { isFormAnalyticsRoute } from "@/lib/analytics/form-analytics";
import {
  ACCURACY_PRESETS,
  parseAccuracyText,
  sanitizeAccuracyText,
  type PracticeModeFilter,
  type PracticeSourceFilter,
} from "@/lib/analytics/filters";
import { getEnabledSeasons } from "@/lib/seasons";
import { cn } from "@/lib/utils";

const MODE_LABELS: Record<PracticeModeFilter, string> = { all: "Both", trial: "Trial", competitive: "Competitive" };
const SOURCE_LABELS: Record<PracticeSourceFilter, string> = { all: "Both", practice: "Practice", live: "Live" };

/** Pages whose job is the raw, unfiltered entry table — no accuracy filter, and excluded entries stay visible. */
const RAW_ROUTE_PREFIXES = ["/analytics/match-scout"];

export function isRawAnalyticsRoute(pathname: string): boolean {
  return RAW_ROUTE_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The one filter bar for every Analytics subpage (mounted in the Analytics
 * layout): Game, Event, Practice (+ Mode/Source), and — except on the raw
 * Match Scout Analytics table — the Accuracy filter. All state lives in the
 * URL (see filter-context.tsx), so it persists across subpages and is shareable.
 */
export function AnalyticsFilterBar() {
  const pathname = usePathname();
  const raw = isRawAnalyticsRoute(pathname);
  // P30: the six form pages have no Practice mode and no accuracy (their entries aren't scored), so the bar is just Game and Event there
  const formRoute = isFormAnalyticsRoute(pathname);
  const { filters, setFilters, singleEvent, singleEventInPractice } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const single = useSingleEvent();

  // Single-event mode normally only applies to real-event data (Practice shows several events at
  // once) — unless the page needs one event even then (the Pick List).
  const singleMode = singleEvent && (!filters.practice || singleEventInPractice);
  // A single-event page shows exactly one event, so the "N of M" count must be that event's, not the URL's whole selection.
  const countFilters = useMemo(
    () => (singleMode ? { ...filters, events: { kind: "custom" as const, codes: single.code ? [single.code] : [] } } : undefined),
    [singleMode, filters, single.code]
  );
  const { scopeCount, usedCount, loaded } = useAnalyticsEntries(countFilters, raw ? { applyAccuracy: false, includeExcluded: true } : undefined);
  const games = getEnabledSeasons();

  return (
    <div className="glass-card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <Control label="Game">
          <Select value={filters.gameId} onValueChange={(v) => setFilters({ gameId: v, events: { kind: "active" } })}>
            <SelectTrigger className="w-44">
              <SelectValue>{games.find((g) => g.id === filters.gameId)?.name ?? filters.gameId}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {games.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Control>

        <Control label={singleMode ? "Event" : "Events"}>
          <EventMultiSelect
            options={data.eventOptions}
            scope={filters.events}
            onChange={(events) => setFilters({ events })}
            singleEvent={singleMode}
            practice={filters.practice && !formRoute}
            primaryCode={data.primaryCode}
            singleSelectedCode={single.code}
          />
        </Control>

        {!formRoute && (
        <label className="flex h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
          <Checkbox checked={filters.practice} onCheckedChange={(v) => setFilters({ practice: v === true, events: { kind: "active" } })} aria-label="Practice data" />
          Practice
        </label>
        )}

        {filters.practice && !formRoute && (
          <>
            <Control label="Mode">
              <Select value={filters.practiceMode} onValueChange={(v) => setFilters({ practiceMode: v as PracticeModeFilter })}>
                <SelectTrigger className="w-40">
                  <SelectValue>{MODE_LABELS[filters.practiceMode]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(MODE_LABELS) as PracticeModeFilter[]).map((m) => (
                    <SelectItem key={m} value={m}>
                      {MODE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>
            <Control label="Source">
              <Select value={filters.practiceSource} onValueChange={(v) => setFilters({ practiceSource: v as PracticeSourceFilter })}>
                <SelectTrigger className="w-40">
                  <SelectValue>{SOURCE_LABELS[filters.practiceSource]}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(SOURCE_LABELS) as PracticeSourceFilter[]).map((s) => (
                    <SelectItem key={s} value={s}>
                      {SOURCE_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Control>
          </>
        )}

        {!raw && !formRoute && (
          <Control
            label="Accuracy"
            hint={
              <InfoTip label="About the accuracy filter" align="start">
                <p className="font-semibold">Accuracy filter</p>
                <p className="mt-1 text-[var(--muted-foreground)]">
                  Accuracy is measured per alliance in a match (one session, one alliance of 2 robots) — the only reliable way to check a scout. With a
                  threshold, only entries whose alliance accuracy can be computed and is at or above it are used.
                </p>
                <p className="mt-1 text-[var(--muted-foreground)]">
                  <strong className="text-[var(--foreground)]">ALL</strong> uses every entry, including ones whose accuracy can&apos;t be computed (e.g. the
                  other robot wasn&apos;t scouted). Entries excluded from stats are always ignored.
                </p>
              </InfoTip>
            }
          >
            <AccuracySegmented />
          </Control>
        )}
      </div>

      {!formRoute && (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted-foreground)]">
        <span aria-live="polite" className="tabular-nums">
          {loaded ? (
            <>
              <strong className="text-sm text-[var(--foreground)]">{usedCount}</strong> of {scopeCount} {scopeCount === 1 ? "entry" : "entries"} shown
            </>
          ) : (
            "Loading entries…"
          )}
        </span>
        {!raw && loaded && scopeCount > usedCount && (
          <span>
            {scopeCount - usedCount} hidden (excluded from stats{filters.accuracy !== null ? " or below the accuracy threshold" : ""})
          </span>
        )}
      </div>
      )}
    </div>
  );
}

function Control({ label, hint, children }: { label: string; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        <Label className="mb-0 text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{label}</Label>
        {hint}
      </div>
      {children}
    </div>
  );
}

/** ALL / 75% / 85% / 90% / Custom. Custom shows a 1-3 digit field, clamped to 1-100. */
function AccuracySegmented() {
  const { filters, setFilters } = useAnalyticsFilters();
  const accuracy = filters.accuracy;
  const isPreset = accuracy !== null && (ACCURACY_PRESETS as readonly number[]).includes(accuracy);

  // Custom stays open after it's clicked even while its field is still empty (the filter stays ALL until a number is typed).
  const [customOpen, setCustomOpen] = useState(false);
  // `null` = show the canonical value; a string = what the user is mid-typing.
  const [draft, setDraft] = useState<string | null>(null);

  const customActive = customOpen || (accuracy !== null && !isPreset);
  const segment = customActive ? "custom" : accuracy === null ? "all" : String(accuracy);

  const select = (value: string) => {
    setDraft(null);
    if (value === "all") {
      setCustomOpen(false);
      setFilters({ accuracy: null });
    } else if (value === "custom") {
      setCustomOpen(true);
    } else {
      setCustomOpen(false);
      setFilters({ accuracy: Number(value) });
    }
  };

  const onType = (text: string) => {
    const clean = sanitizeAccuracyText(text);
    setDraft(clean);
    const parsed = parseAccuracyText(clean);
    // Typing refines one value, so replace the history entry instead of pushing one per keystroke.
    setFilters({ accuracy: parsed }, "replace");
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={segment} onValueChange={select}>
        <TabsList className="h-11">
          <TabsTrigger value="all">ALL</TabsTrigger>
          {ACCURACY_PRESETS.map((p) => (
            <TabsTrigger key={p} value={String(p)}>
              {p}%
            </TabsTrigger>
          ))}
          <TabsTrigger value="custom">Custom</TabsTrigger>
        </TabsList>
      </Tabs>
      {customActive && (
        <div className="flex items-center gap-1.5">
          <input
            inputMode="numeric"
            aria-label="Custom accuracy threshold, 1 to 100"
            placeholder="1–100"
            maxLength={3}
            value={draft ?? (accuracy === null ? "" : String(accuracy))}
            onChange={(e) => onType(e.target.value)}
            onBlur={() => setDraft(null)}
            className={cn(
              "h-11 w-20 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-3 text-center text-sm tabular-nums outline-none",
              "transition-shadow duration-300 focus:shadow-[0_0_0_3px_rgba(var(--glow),0.25)]"
            )}
          />
          <span className="text-sm text-[var(--muted-foreground)]">%</span>
        </div>
      )}
    </div>
  );
}
