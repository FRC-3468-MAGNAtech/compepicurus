"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { MatchRow, matchRowId } from "@/components/analytics/match-row";
import { useAnalyticsData, useAnalyticsEntries } from "@/lib/analytics/data-context";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { resolveEventCodes } from "@/lib/analytics/filters";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { buildMatchBreakdowns, libraryMatchToOfficial, matchHasTeam, matchKey, type OfficialMatch } from "@/lib/analytics/match-breakdown";
import { useEventMatches } from "@/lib/analytics/use-event-data";
import type { MatchType } from "@/lib/ftc/types";

type TypeFilter = "all" | MatchType;

const TYPE_FILTERS: { value: TypeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "Practice", label: "P" },
  { value: "Qualification", label: "Q" },
  { value: "Playoff", label: "F" },
];

const TYPE_BY_PREFIX = Object.fromEntries(Object.entries(MATCH_TYPE_PREFIX).map(([type, prefix]) => [prefix, type])) as Record<string, MatchType>;

/** "Q12" → Qualification 12 (the format Team Profile's links use); null if it isn't one. */
function parseMatchLabel(label: string): { matchType: MatchType; matchNumber: number } | null {
  const m = /^([PQF])(\d+)$/i.exec(label.trim());
  return m ? { matchType: TYPE_BY_PREFIX[m[1].toUpperCase()], matchNumber: Number(m[2]) } : null;
}

export default function MatchBreakdownPage() {
  const searchParams = useSearchParams();
  const { filters } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const practice = filters.practice;

  // Entries before the accuracy filter: Match Breakdown applies it per alliance itself, so a rejected
  // alliance can be shown dimmed with its reason instead of silently vanishing. Excluded entries are already dropped.
  const { entries, scope, loaded, schema } = useAnalyticsEntries(undefined, { applyAccuracy: false });

  // --- the official matches ---------------------------------------------------
  const eventCodes = useMemo(() => {
    const codes = resolveEventCodes(filters, data.activeEventCodes);
    // "All events" = every event that has scouted data.
    return codes ?? [...new Set(scope.map((e) => e.eventCode))];
  }, [filters, data.activeEventCodes, scope]);

  const requests = useMemo(
    () => (practice ? [] : eventCodes.map((code) => ({ code, season: data.eventDirectory.get(code)?.season ?? data.season }))),
    [practice, eventCodes, data.eventDirectory, data.season]
  );
  const { matches: eventMatches, loading: matchesLoading } = useEventMatches(requests);

  const officialMatches = useMemo<OfficialMatch[]>(() => {
    if (!practice) return eventMatches;
    // Practice mode: the imported library matches for this game (and the chosen events, if any).
    const codes = resolveEventCodes(filters, data.activeEventCodes);
    return data.libraryMatches
      .filter((m) => m.seasonId === filters.gameId && (codes === null || codes.includes(m.eventCode)))
      .map(libraryMatchToOfficial);
  }, [practice, eventMatches, data.libraryMatches, filters, data.activeEventCodes]);

  const breakdowns = useMemo(
    () => buildMatchBreakdowns({ matches: officialMatches, entries, accuracyThreshold: filters.accuracy, practice }),
    [officialMatches, entries, filters.accuracy, practice]
  );

  // --- list controls -----------------------------------------------------------
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [search, setSearch] = useState("");

  const counts = useMemo(() => {
    const c: Record<TypeFilter, number> = { all: breakdowns.length, Practice: 0, Qualification: 0, Playoff: 0 };
    for (const b of breakdowns) c[b.match.matchType] += 1;
    return c;
  }, [breakdowns]);

  const visible = useMemo(
    () => breakdowns.filter((b) => (typeFilter === "all" || b.match.matchType === typeFilter) && matchHasTeam(b, search)),
    [breakdowns, typeFilter, search]
  );

  const showEvent = useMemo(() => new Set(breakdowns.map((b) => b.match.eventCode)).size > 1, [breakdowns]);
  const scoutedCount = breakdowns.filter((b) => b.scouted).length;

  // Scouted entries whose match isn't in the official list (e.g. practice matches the FIRST API doesn't track).
  const orphanCount = useMemo(() => {
    const known = new Set(officialMatches.map((m) => matchKey(m.eventCode, m.matchType, m.matchNumber)));
    return entries.filter((e) => !known.has(matchKey(e.eventCode, e.matchType, e.matchNumber))).length;
  }, [officialMatches, entries]);

  // --- expand / deep link (?event=CODE&match=Q12 from Team Profile) -------------------
  const deepMatch = searchParams.get("match");
  const deepEvent = searchParams.get("event");
  const deepKey = useMemo(() => {
    const parsed = deepMatch ? parseMatchLabel(deepMatch) : null;
    if (!parsed) return null;
    return breakdowns.find((b) => b.match.matchType === parsed.matchType && b.match.matchNumber === parsed.matchNumber && (!deepEvent || b.match.eventCode === deepEvent))?.key ?? null;
  }, [deepMatch, deepEvent, breakdowns]);

  // `undefined` = the user hasn't touched it yet, so the deep-linked match (if any) is open.
  const [picked, setPicked] = useState<string | null | undefined>(undefined);
  const expandedKey = picked === undefined ? deepKey : picked;

  const scrolled = useRef(false);
  useEffect(() => {
    if (!deepKey || scrolled.current) return;
    const el = document.getElementById(matchRowId(deepKey));
    if (el) {
      scrolled.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [deepKey, visible]);

  const showSkeleton = !loaded || (!practice && matchesLoading && breakdowns.length === 0);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Match Breakdown</h2>
          <p className="text-sm text-[var(--muted-foreground)]">
            Every official match with what was scouted for it. Tap a match for each robot&apos;s score, the alliance totals, and accuracy.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team number..." className="pl-10" aria-label="Search matches by team number" inputMode="numeric" />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Tabs value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
            <TabsList className="w-max">
              {TYPE_FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value}>
                  {f.label} <span className="tabular-nums opacity-70">{counts[f.value]}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {!showSkeleton && breakdowns.length > 0 && (
          <span className="text-xs tabular-nums text-[var(--muted-foreground)]">
            {visible.length === breakdowns.length ? `${breakdowns.length} matches` : `${visible.length} of ${breakdowns.length} matches`} · {scoutedCount} scouted
          </span>
        )}
      </div>

      {showSkeleton ? (
        <div className="flex flex-col gap-3" aria-busy>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="glass-card h-[148px] animate-pulse" />
          ))}
        </div>
      ) : breakdowns.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          {practice
            ? "No library matches for these filters. Import events in Admin Panel > Match Library, or widen the Event filter."
            : "No official matches for the selected events yet. Set an active event, or pick one in the Event filter above."}
        </GlassPanel>
      ) : visible.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">No matches fit this search or match type.</GlassPanel>
      ) : (
        <div className="flex flex-col gap-3">
          {visible.map((b) => (
            <MatchRow
              key={b.key}
              breakdown={b}
              schema={schema}
              expanded={expandedKey === b.key}
              onToggle={() => setPicked(expandedKey === b.key ? null : b.key)}
              showEvent={showEvent}
            />
          ))}
        </div>
      )}

      {!showSkeleton && orphanCount > 0 && (
        <p className="text-xs text-[var(--muted-foreground)]">
          {orphanCount} scouted {orphanCount === 1 ? "entry belongs" : "entries belong"} to matches that aren&apos;t in the official match list (for example practice
          matches the FIRST API doesn&apos;t track), so {orphanCount === 1 ? "it isn't" : "they aren't"} shown here — see Match Scout Analytics for the raw entries.
        </p>
      )}
    </div>
  );
}
