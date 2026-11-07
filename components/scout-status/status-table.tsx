"use client";

import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronRight, Search } from "lucide-react";
import { AnalyticsLink } from "@/components/analytics/analytics-link";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import { getPercentColor } from "@/lib/accuracy/engine";
import { STATUS_CATEGORIES, type StatusCategory } from "@/lib/scout-status/categories";
import type { EventContext, ScoutRow, ScoutStatusPill } from "@/lib/scout-status/compute";
import { cn } from "@/lib/utils";

type SortKey = "name" | "matches" | "entries" | "progress" | "last" | "accuracy" | "flagged" | "missing" | "status";

const PILL: Record<ScoutStatusPill, { label: string; className: string; order: number }> = {
  behind: { label: "Behind", className: "bg-red-500/15 text-red-300 border border-red-400/30", order: 0 },
  "not-started": { label: "Not started", className: "bg-slate-500/20 text-slate-300 border border-slate-400/30", order: 1 },
  "on-track": { label: "On track", className: "bg-sky-500/15 text-sky-300 border border-sky-400/30", order: 2 },
  "no-target": { label: "No target", className: "bg-white/8 text-[var(--muted-foreground)] border border-[var(--glass-border)]", order: 3 },
  complete: { label: "Complete", className: "bg-emerald-500/15 text-emerald-300 border border-emerald-400/30", order: 4 },
};

const progressOf = (r: ScoutRow): number => (r.target && r.target > 0 ? r.entries / r.target : r.entries > 0 ? 1 : 0);

function sortValue(r: ScoutRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return r.name.toLowerCase();
    case "matches":
      return r.matchesScouted;
    case "entries":
      return r.entries;
    case "progress":
      return progressOf(r);
    case "last":
      return r.lastEntry?.atMs ?? 0;
    case "accuracy":
      return r.avgAccuracy ?? -1;
    case "flagged":
      return r.flagged;
    case "missing":
      return r.missingAssigned ?? -1;
    case "status":
      return PILL[r.status].order;
  }
}

function relativeTime(ms: number, now: number): string {
  const sec = Math.max(0, Math.round((now - ms) / 1000));
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 48) return `${hr} h ago`;
  return `${Math.round(hr / 24)} d ago`;
}

export function StatusTable({
  rows,
  totals,
  entries,
  events,
  enabled,
  hasAssignments,
  now,
}: {
  rows: ScoutRow[];
  totals: { matchesScouted: number; entries: number; target: number | null; flagged: number; avgAccuracy: number | null };
  entries: AnalyticsEntry[];
  events: EventContext[];
  enabled: ReadonlySet<StatusCategory>;
  hasAssignments: boolean;
  /** Passed in so rendering stays pure. */
  now: number;
}) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "status", dir: "asc" });
  const [open, setOpen] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows;
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = sortValue(a, sort.key);
      const bv = sortValue(b, sort.key);
      if (av < bv) return -1 * sign;
      if (av > bv) return 1 * sign;
      return a.name.localeCompare(b.name);
    });
  }, [rows, search, sort]);

  const header = (key: SortKey, label: string, className?: string) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none"} className={cn("whitespace-nowrap px-3 py-2 font-medium", className)}>
      <button type="button" onClick={() => setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" }))} className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-[var(--foreground)]">
        {label}
        {sort.key === key && (sort.dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
      </button>
    </th>
  );

  const eventsByCode = new Map(events.map((e) => [e.eventCode, e]));
  const entriesOf = (uid: string) =>
    entries
      .filter((e) => e.uid === uid && eventsByCode.get(e.eventCode)?.includes(e.matchType, e.matchNumber))
      .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative max-w-xs">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
        <Input aria-label="Search scouts by name" className="h-10 pl-10" placeholder="Search scouts" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[var(--glass-border)]">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead className="sticky top-0 z-20 bg-[#1b1b26] text-[11px] text-[var(--muted-foreground)]">
            <tr>
              {header("name", "Scout", "sticky left-0 z-30 bg-[#1b1b26]")}
              {header("matches", "Matches scouted")}
              {header("progress", "Entries / target")}
              {header("last", "Last entry")}
              {header("accuracy", "Avg accuracy")}
              {header("flagged", "Flagged")}
              {hasAssignments && header("missing", "Missing assigned")}
              {header("status", "Status")}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--glass-border)]">
            {visible.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  {rows.length === 0 ? "No scouts yet — mark Match Scouts as attending on the Assignments page, or add members under Individual scout targets." : "No scouts match that search."}
                </td>
              </tr>
            )}
            {visible.map((r) => {
              const expanded = open === r.uid;
              const pct = r.target && r.target > 0 ? Math.min(100, (r.entries / r.target) * 100) : null;
              return (
                <RowGroup key={r.uid} expanded={expanded}>
                  <tr className="align-top transition-colors hover:bg-white/4">
                    <td className="sticky left-0 z-10 bg-[#1b1b26] px-3 py-2.5">
                      <button type="button" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} ${r.name}'s entries`} onClick={() => setOpen(expanded ? null : r.uid)} className="flex items-center gap-1.5 text-left">
                        <ChevronRight className={cn("h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform", expanded && "rotate-90")} aria-hidden />
                        <span>
                          <span className="block font-medium">{r.name}</span>
                          <span className="block text-[11px] text-[var(--muted-foreground)]">{r.inTargets ? r.role : "not in targets"}</span>
                        </span>
                      </button>
                    </td>
                    <td className="px-3 py-2.5 tabular-nums">{r.matchesScouted}</td>
                    <td className="min-w-44 px-3 py-2.5">
                      <div className="tabular-nums">
                        {r.entries} / {r.target ?? "—"}
                      </div>
                      {pct !== null && (
                        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-white/10" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={`${r.name}'s progress`}>
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--theme-gradient-h)" }} />
                        </div>
                      )}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {STATUS_CATEGORIES.filter((c) => enabled.has(c.id)).map((c) => {
                          const cat = r.byCategory[c.id];
                          return (
                            <span key={c.id} title={`${c.label}: ${cat.entries} of ${cat.target ?? "no target"}`} className="rounded bg-white/8 px-1.5 py-0.5 text-[10px] tabular-nums text-[var(--muted-foreground)]">
                              {c.prefix} {cat.entries}/{cat.target ?? "—"}
                            </span>
                          );
                        })}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.lastEntry ? (
                        <span title={new Date(r.lastEntry.atMs).toLocaleString()}>
                          {relativeTime(r.lastEntry.atMs, now)}
                          <span className="block text-[11px] text-[var(--muted-foreground)]">{r.lastEntry.label}</span>
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={cn("px-3 py-2.5 tabular-nums", r.avgAccuracy !== null && getPercentColor(r.avgAccuracy))}>{r.avgAccuracy === null ? "—" : `${Math.round(r.avgAccuracy)}%`}</td>
                    <td className="px-3 py-2.5 tabular-nums">{r.flagged > 0 ? <Badge variant="warning">{r.flagged}</Badge> : 0}</td>
                    {hasAssignments && <td className="px-3 py-2.5 tabular-nums">{r.missingAssigned ?? "—"}</td>}
                    <td className="px-3 py-2.5">
                      <span className={cn("inline-flex rounded-full px-2.5 py-1 text-xs font-semibold", PILL[r.status].className)}>{PILL[r.status].label}</span>
                    </td>
                  </tr>
                  {expanded && (
                    <tr>
                      <td colSpan={hasAssignments ? 8 : 7} className="bg-white/3 px-4 py-3">
                        <EntryList entries={entriesOf(r.uid)} scoutName={r.name} events={eventsByCode} now={now} />
                      </td>
                    </tr>
                  )}
                </RowGroup>
              );
            })}
          </tbody>
          <tfoot className="border-t border-[var(--glass-border)] bg-white/4 text-sm font-medium">
            <tr>
              <td className="sticky left-0 z-10 bg-[#1b1b26] px-3 py-2.5">Total</td>
              <td className="px-3 py-2.5 tabular-nums">{totals.matchesScouted}</td>
              <td className="px-3 py-2.5 tabular-nums">
                {totals.entries} / {totals.target ?? "—"}
              </td>
              <td className="px-3 py-2.5" />
              <td className={cn("px-3 py-2.5 tabular-nums", totals.avgAccuracy !== null && getPercentColor(totals.avgAccuracy))}>{totals.avgAccuracy === null ? "—" : `${Math.round(totals.avgAccuracy)}%`}</td>
              <td className="px-3 py-2.5 tabular-nums">{totals.flagged}</td>
              {hasAssignments && <td className="px-3 py-2.5" />}
              <td className="px-3 py-2.5" />
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

/** A table body group: a data row plus its expansion row, as siblings. */
function RowGroup({ children }: { children: React.ReactNode; expanded: boolean }) {
  return <>{children}</>;
}

function EntryList({ entries, scoutName, events, now }: { entries: AnalyticsEntry[]; scoutName: string; events: Map<string, EventContext>; now: number }) {
  if (entries.length === 0) return <p className="text-sm text-[var(--muted-foreground)]">No entries in the current filters.</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {entries.slice(0, 60).map((e) => {
          const cat = events.get(e.eventCode)?.categoryOf(e.matchType, e.matchNumber);
          const prefix = STATUS_CATEGORIES.find((c) => c.id === cat)?.prefix ?? "?";
          const flagged = e.autoFlags.some((f) => !f.dismissed) || e.manualFlags.length > 0;
          return (
            <li key={e.id} className="flex items-center gap-2 rounded-xl border border-[var(--glass-border)] bg-white/4 px-3 py-1.5 text-xs">
              <span className="font-mono font-semibold">
                {prefix}
                {e.matchNumber}
              </span>
              <span className="tabular-nums">Team {e.teamNumber}</span>
              <span className="text-[var(--muted-foreground)]" title={new Date(e.submittedAt).toLocaleString()}>
                {relativeTime(Date.parse(e.submittedAt) || 0, now)}
              </span>
              <span className={cn("ml-auto tabular-nums", e.allianceAccuracy !== null && getPercentColor(e.allianceAccuracy))}>{e.allianceAccuracy === null ? "—" : `${Math.round(e.allianceAccuracy)}%`}</span>
              {flagged && <Badge variant="warning" className="text-[10px]">Flag</Badge>}
            </li>
          );
        })}
      </ul>
      {entries.length > 60 && <p className="text-xs text-[var(--muted-foreground)]">Showing the 60 most recent of {entries.length}.</p>}
      <AnalyticsLink href="/analytics/match-scout" params={{ scout: scoutName }} className="self-start text-xs font-medium text-[var(--color-accent)] underline underline-offset-2">
        Open {scoutName}&apos;s entries in Match Scout Analytics
      </AnalyticsLink>
    </div>
  );
}
