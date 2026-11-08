"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { CalendarX2, Clock, RefreshCw, Search, Trophy } from "lucide-react";
import { OUR_TEAM_ROW_CLASS, OurTeamTag } from "@/components/analytics/team-bits";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { FtcEvent } from "@/lib/ftc/types";
import { MATCH_LIST_TABS, buildMatchRows, defaultTab, filterRows, formatStart, rowsInTab, tabCounts, winnerOf, type MatchListRow, type MatchListStatus, type MatchListTab } from "@/lib/match-list/model";
import { cn } from "@/lib/utils";

// FIX4: the Match List page. Everything is plain props (the connected page feeds it the active events, the FIRST API
// schedule and the account's FTC teams; the browser-test fixture feeds it fixed data), so what is shown is decided
// in lib/match-list/model.ts and only drawn here.

const STATUS: Record<MatchListStatus, { label: string; variant: "glass" | "success" | "outline" }> = {
  upcoming: { label: "Upcoming", variant: "glass" },
  "in-progress": { label: "In Progress", variant: "success" },
  completed: { label: "Completed", variant: "outline" },
};

const ALL = "all";

export type MatchListScreenProps = {
  /** The active events, in the account's order (the primary first). */
  events: FtcEvent[];
  eventsLoaded: boolean;
  matches: OfficialMatch[];
  /** Waiting for the first schedule. */
  loading: boolean;
  /** The last fetch failed (the matches shown, if any, are the last good ones). */
  error: boolean;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  isOurTeam: (n: number) => boolean;
  /** The clock the statuses are computed against. */
  now: number;
};

export function MatchListScreen({ events, eventsLoaded, matches, loading, error, updatedAt, refreshing, onRefresh, isOurTeam, now }: MatchListScreenProps) {
  const [eventSel, setEventSel] = useState<string>(ALL);
  const [pickedTab, setPickedTab] = useState<MatchListTab | null>(null);
  const [ourOnly, setOurOnly] = useState(false);
  const [search, setSearch] = useState("");

  // A selection that no longer exists (an event was deactivated) falls back to all of them.
  const selected = eventSel !== ALL && events.some((e) => e.code === eventSel) ? eventSel : ALL;
  const shownEvents = useMemo(() => (selected === ALL ? events : events.filter((e) => e.code === selected)), [events, selected]);

  const rowsByEvent = useMemo(
    () => new Map(events.map((e) => [e.code, buildMatchRows({ eventCode: e.code, matches, timeZone: e.timezone, now, isOurTeam })])),
    [events, matches, now, isOurTeam]
  );
  const shownRows = useMemo(() => shownEvents.flatMap((e) => rowsByEvent.get(e.code) ?? []), [shownEvents, rowsByEvent]);
  const tab = pickedTab ?? defaultTab(shownRows);
  const counts = tabCounts(shownRows);
  const filtersOn = ourOnly || search.trim() !== "";

  // Scroll to the next upcoming match when a view opens (first load, a new event, a new tab) — never on a data refresh or a filter.
  const scrolledFor = useRef<string | null>(null);
  const viewKey = `${selected}|${tab}`;
  const ready = eventsLoaded && !loading && shownRows.length > 0;
  useEffect(() => {
    if (!ready || scrolledFor.current === viewKey) return;
    scrolledFor.current = viewKey;
    document.querySelector<HTMLElement>('[data-testid="match-list"] [data-next="true"]')?.scrollIntoView({ block: "center" });
  }, [ready, viewKey]);

  if (eventsLoaded && events.length === 0) {
    return (
      <div className="flex flex-col gap-6">
        <Header updatedAt={null} refreshing={false} onRefresh={onRefresh} canRefresh={false} />
        <GlassPanel data-testid="match-list-empty" className="flex flex-col items-center gap-2 py-12 text-center">
          <CalendarX2 className="h-7 w-7 text-[var(--muted-foreground)]" aria-hidden />
          <div className="font-semibold">No active events yet</div>
          <p className="max-w-md text-sm text-[var(--muted-foreground)]">The Match List shows the schedule for the events your team is signed up for. Ask an admin to pick the active events, and the schedule will appear here.</p>
        </GlassPanel>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <Header updatedAt={updatedAt} refreshing={refreshing} onRefresh={onRefresh} canRefresh={eventsLoaded && events.length > 0} />

      {events.length > 1 && (
        <Tabs value={selected} onValueChange={(v) => { setEventSel(v); setPickedTab(null); }}>
          <TabsList className="max-w-full overflow-x-auto" aria-label="Event" data-testid="event-switcher">
            <TabsTrigger value={ALL} className="shrink-0 whitespace-nowrap">
              All events
            </TabsTrigger>
            {events.map((e) => (
              <TabsTrigger key={e.code} value={e.code} title={e.name} className="shrink-0 whitespace-nowrap" data-testid={`event-tab-${e.code}`}>
                {e.name}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}

      <Tabs value={tab} onValueChange={(v) => setPickedTab(v as MatchListTab)}>
        <TabsList className="max-w-full overflow-x-auto" aria-label="Match type" data-testid="match-tabs">
          {MATCH_LIST_TABS.map((t) => (
            <TabsTrigger key={t.id} value={t.id} className="shrink-0 whitespace-nowrap" data-testid={`tab-${t.id}`}>
              {t.label}
              <span className="ml-1.5 text-xs opacity-70 tabular-nums">{counts[t.id]}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs value={ourOnly ? "ours" : "all"} onValueChange={(v) => setOurOnly(v === "ours")}>
          <TabsList aria-label="Which matches" data-testid="match-filter">
            <TabsTrigger value="all">All matches</TabsTrigger>
            <TabsTrigger value="ours">Our matches</TabsTrigger>
          </TabsList>
        </Tabs>
        <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
          <span className="sr-only">Search by team number</span>
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} inputMode="numeric" placeholder="Search by team number" className="pl-10" data-testid="match-search" />
        </label>
      </div>

      {error && !loading && (
        <p role="alert" data-testid="match-list-error" className="glass-card px-4 py-3 text-sm text-amber-200">
          Couldn&apos;t reach the FIRST schedule just now{shownRows.length > 0 ? ", so this is the last schedule we have" : ""}. It retries on its own; you can also press Refresh.
        </p>
      )}

      <div data-testid="match-list" className="flex flex-col gap-6">
        {!eventsLoaded || loading ? (
          <MatchListSkeleton />
        ) : (
          shownEvents.map((event) => {
            const inTab = rowsInTab(rowsByEvent.get(event.code) ?? [], tab);
            const visible = filterRows(inTab, { ourOnly, search });
            return (
              <section key={event.code} aria-label={event.name} data-testid={`match-group-${event.code}`} className="flex flex-col gap-2">
                {shownEvents.length > 1 && (
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]" title={event.name}>
                    {event.name} <span className="font-normal normal-case opacity-70">· {event.code}</span>
                  </h2>
                )}
                {visible.length === 0 ? (
                  <EmptyGroup scheduled={inTab.length} tab={tab} filtersOn={filtersOn} onClear={() => { setOurOnly(false); setSearch(""); }} />
                ) : (
                  <ul className="flex flex-col gap-2">
                    {visible.map((row) => (
                      <MatchCard key={row.key} row={row} timeZone={event.timezone} showEvent={false} isOurTeam={isOurTeam} />
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        )}
      </div>
    </div>
  );
}

/** False while the server renders (and for the first client render), true after: the time is the viewer's own, which the server can't know. */
const useIsClient = () => useSyncExternalStore(() => () => {}, () => true, () => false);

function Header({ updatedAt, refreshing, onRefresh, canRefresh }: { updatedAt: number | null; refreshing: boolean; onRefresh: () => void; canRefresh: boolean }) {
  const isClient = useIsClient();
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Match List</h1>
        <p className="text-sm text-[var(--muted-foreground)]">The schedule and results for the events your team is signed up for.</p>
      </div>
      {canRefresh && (
        <div className="flex items-center gap-3">
          <span data-testid="last-updated" className="text-xs text-[var(--muted-foreground)]" aria-live="polite">
            {updatedAt === null ? "Not updated yet" : isClient ? `Updated ${new Date(updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : "Updated"}
          </span>
          <Button variant="glass" size="sm" onClick={onRefresh} disabled={refreshing} className="gap-2" data-testid="refresh-matches">
            <RefreshCw className={cn("h-4 w-4", refreshing && "animate-spin")} aria-hidden /> {refreshing ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Same height as a card, so nothing moves when the schedule arrives. */
export const MATCH_CARD_MIN_HEIGHT = "min-h-[112px]";

function MatchListSkeleton() {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-label="Loading the match schedule" data-testid="match-list-skeleton">
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <div key={i} className={cn("glass-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center", MATCH_CARD_MIN_HEIGHT)}>
          <Shimmer className="h-6 w-20" />
          <Shimmer className="h-12 flex-1" />
          <Shimmer className="h-8 w-28" />
        </div>
      ))}
    </div>
  );
}

function EmptyGroup({ scheduled, tab, filtersOn, onClear }: { scheduled: number; tab: MatchListTab; filtersOn: boolean; onClear: () => void }) {
  const tabLabel = MATCH_LIST_TABS.find((t) => t.id === tab)!.label.toLowerCase();
  return (
    <GlassPanel data-testid="match-group-empty" className="flex flex-col items-center gap-2 py-8 text-center">
      <Clock className="h-6 w-6 text-[var(--muted-foreground)]" aria-hidden />
      {scheduled > 0 && filtersOn ? (
        <>
          <div className="font-semibold">No matches fit those filters</div>
          <Button variant="glass" size="sm" onClick={onClear}>
            Clear filters
          </Button>
        </>
      ) : (
        <>
          <div className="font-semibold">No {tabLabel} matches yet</div>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)]">FIRST hasn&apos;t published them. They show up here as soon as they&apos;re scheduled.</p>
        </>
      )}
    </GlassPanel>
  );
}

function TeamChip({ team, ours }: { team: number; ours: boolean }) {
  return (
    <span className={cn("flex items-center gap-1.5 rounded-lg px-2 py-1", ours && "bg-[rgba(var(--glow),0.22)] ring-1 ring-[var(--color-primary)]")} data-ours={ours ? "true" : undefined}>
      <span className="font-semibold tabular-nums">{team}</span>
      {ours && <OurTeamTag />}
    </span>
  );
}

const SIDE = {
  red: { label: "Red", box: "border-red-400/30 bg-red-500/10", text: "text-red-300" },
  blue: { label: "Blue", box: "border-blue-400/30 bg-blue-500/10", text: "text-blue-300" },
} as const;

function Alliance({ side, teams, score, won, isOurTeam }: { side: "red" | "blue"; teams: number[]; score: number | null; won: boolean; isOurTeam: (n: number) => boolean }) {
  const s = SIDE[side];
  return (
    <div className={cn("flex min-w-0 flex-col gap-1 rounded-xl border p-2", s.box)} data-side={side}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-[11px] font-semibold uppercase tracking-wide", s.text)}>{s.label}</span>
        {score !== null && (
          <span className={cn("flex items-center gap-1 text-lg tabular-nums", won ? "font-bold" : "text-[var(--muted-foreground)]")} data-testid={`${side}-score`}>
            {won && <Trophy className="h-3.5 w-3.5" aria-label="Winner" />}
            {score}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-x-2 gap-y-1 text-sm">
        {teams.length === 0 ? <span className="text-[var(--muted-foreground)]">TBD</span> : teams.map((t) => <TeamChip key={t} team={t} ours={isOurTeam(t)} />)}
      </div>
    </div>
  );
}

export function matchCardId(key: string): string {
  return `match-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

function MatchCard({ row, timeZone, showEvent, isOurTeam }: { row: MatchListRow; timeZone: string | null; showEvent: boolean; isOurTeam: (n: number) => boolean }) {
  const status = STATUS[row.status];
  const winner = winnerOf(row);
  return (
    <li
      id={matchCardId(row.key)}
      data-testid={`match-${row.label}`}
      data-status={row.status}
      data-ours={row.ours ? "true" : undefined}
      data-next={row.isNext ? "true" : undefined}
      className={cn(
        "glass-card grid scroll-mt-28 items-center gap-3 p-3 sm:grid-cols-[7.5rem_1fr_auto]",
        MATCH_CARD_MIN_HEIGHT,
        row.ours && OUR_TEAM_ROW_CLASS,
        row.isNext && "ring-2 ring-[var(--color-primary)]"
      )}
    >
      <div className="flex items-baseline justify-between gap-2 sm:block">
        <div className="text-xl font-semibold tracking-tight">{row.label}</div>
        <div className="text-xs text-[var(--muted-foreground)]">{formatStart(row.startMs, timeZone)}</div>
        {showEvent && <div className="text-[11px] uppercase text-[var(--muted-foreground)]">{row.eventCode}</div>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Alliance side="red" teams={row.red} score={row.redScore} won={winner === "red"} isOurTeam={isOurTeam} />
        <Alliance side="blue" teams={row.blue} score={row.blueScore} won={winner === "blue"} isOurTeam={isOurTeam} />
      </div>

      <div className="flex flex-wrap items-center gap-2 sm:flex-col sm:items-end">
        <div className="flex flex-wrap items-center gap-1.5">
          {row.isNext && <Badge variant="accent">Next</Badge>}
          <Badge variant={status.variant} data-testid="match-status">
            {row.status === "in-progress" && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-300" aria-hidden />}
            {status.label}
          </Badge>
        </div>
        {row.played && (
          <Link
            href={`/analytics/match-breakdown?event=${encodeURIComponent(row.eventCode)}&match=${row.linkLabel}`}
            className="inline-flex min-h-[2.25rem] items-center rounded-full px-3 text-xs font-medium underline underline-offset-2 hover:text-[var(--color-accent)]"
            data-testid="match-breakdown-link"
          >
            Match Breakdown
          </Link>
        )}
      </div>
    </li>
  );
}
