"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { AlertTriangle, Check, CheckCircle2, Clock, MapPin, RefreshCw, Star, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassSkeletonGrid } from "@/components/ui/glass-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { SelectedEventsPanel, STATUS_BADGE, formatDateRange } from "@/components/event/selected-events-panel";
import { useActiveEvents } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { usePermissions } from "@/lib/permissions";
import { useTeamScoutEntries } from "@/lib/scout-entries";
import { setActiveEvents } from "@/lib/team";
import { MAX_ACTIVE_EVENTS, moveActiveEvent, toggleActiveEvent, type ActiveEventsState } from "@/lib/active-events";
import {
  EVENT_STATUS_ORDER,
  countEventsByStatus,
  getEventStatus,
  sortEvents,
  type EventSort,
  type EventStatusFilter,
} from "@/lib/ftc/event-status";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getEvents, getMatchesForEvent, getTeamsForEvent } from "@/lib/ftc/actions";
import { getDefaultSeason, getSelectableSeasons } from "@/lib/ftc/config";
import { cardEntranceVariants, springSnappy } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { EventLifecycleStatus, FtcEvent, FtcMatch } from "@/lib/ftc/types";

const FILTERS: { value: EventStatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "in-progress", label: "In Progress" },
  { value: "upcoming", label: "Upcoming" },
  { value: "completed", label: "Completed" },
];

const SORT_LABELS: Record<EventSort, string> = {
  status: "Status",
  newest: "Date, newest",
  oldest: "Date, oldest",
};

export default function EventSelectionPage() {
  const { profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const { events: activeEvents, primary, primaryCode } = useActiveEvents();
  const { isAdmin } = usePermissions();
  const { entries: scoutEntries } = useTeamScoutEntries(teamId);
  const seasons = useMemo(() => getSelectableSeasons(), []);
  const [season, setSeason] = useState(() => getDefaultSeason());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<EventStatusFilter>("all");
  const [sort, setSort] = useState<EventSort>("status");
  const [pendingRemoval, setPendingRemoval] = useState<FtcEvent | null>(null);
  const [limitNotice, setLimitNotice] = useState(false);
  // Fixed per visit so every status badge, count, and group agrees with each other.
  const [now] = useState(() => Date.now());

  const eventsQuery = useFtcQuery(`events:${season}`, () => getEvents({ season }));

  const state: ActiveEventsState = useMemo(() => ({ events: activeEvents, primaryCode }), [activeEvents, primaryCode]);
  const activeCodes = useMemo(() => new Set(activeEvents.map((e) => e.code)), [activeEvents]);

  // Search narrows first; the status counts then describe what the search found, so the
  // segmented control never promises events the current search would hide.
  const searched = useMemo(() => {
    const list = eventsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q));
  }, [eventsQuery.data, search]);

  const counts = useMemo(() => countEventsByStatus(searched, now), [searched, now]);

  const visible = useMemo(() => {
    const filtered = statusFilter === "all" ? searched : searched.filter((e) => getEventStatus(e, now) === statusFilter);
    return sortEvents(filtered, sort, now);
  }, [searched, statusFilter, sort, now]);

  // Grouped headings only make sense when sorting by status; date sorts are one flat list.
  const groups = useMemo(() => {
    if (sort !== "status") return [{ key: "all", title: "Events", events: visible }];
    return EVENT_STATUS_ORDER.map((status) => ({
      key: status,
      title: STATUS_BADGE[status].label,
      events: visible.filter((e) => getEventStatus(e, now) === status),
    })).filter((g) => g.events.length > 0);
  }, [visible, sort, now]);

  const commit = (next: ActiveEventsState) => {
    if (!teamId || !isAdmin) return;
    void setActiveEvents(teamId, next);
  };

  const scoutedCount = (code: string) => scoutEntries.filter((e) => e.source === "event" && e.eventCode === code).length;

  const removeEvent = (event: FtcEvent) => {
    if (!isAdmin) return;
    // Taking an event off the active list hides it from every scouting picker, so ask first
    // when the team has already scouted matches for it.
    if (scoutedCount(event.code) > 0) {
      setPendingRemoval(event);
      return;
    }
    commit(toggleActiveEvent(state, event));
  };

  const toggleEvent = (event: FtcEvent) => {
    if (!isAdmin) return;
    if (activeCodes.has(event.code)) {
      removeEvent(event);
      return;
    }
    if (activeEvents.length >= MAX_ACTIVE_EVENTS) {
      setLimitNotice(true);
      return;
    }
    setLimitNotice(false);
    commit(toggleActiveEvent(state, event));
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Active Events</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          {isAdmin
            ? "Pick every event the team is scouting right now (a league meet and a qualifier, say) — every other page reads from these."
            : "Only admins can change the active events — every other page reads from what they pick."}
        </p>
      </div>

      <SelectedEventsPanel
        events={activeEvents}
        primaryCode={primaryCode}
        canEdit={isAdmin}
        onRemove={removeEvent}
        onMove={(code, toIndex) => commit(moveActiveEvent(state, code, toIndex))}
      />

      {primary && <ActiveEventSummary key={primary.code} event={primary} now={now} />}

      <GlassPanel className="flex flex-col gap-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events by name or code..."
            className="flex-1"
          />
          <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
            <SelectTrigger className="sm:w-36">
              <SelectValue>
                {season}&ndash;{season + 1}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {seasons.map((s) => (
                <SelectItem key={s} value={String(s)}>
                  {s}&ndash;{s + 1}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as EventSort)}>
            <SelectTrigger className="sm:w-48" aria-label="Sort events">
              <SelectValue>Sort: {SORT_LABELS[sort]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {(Object.keys(SORT_LABELS) as EventSort[]).map((k) => (
                <SelectItem key={k} value={k}>
                  {SORT_LABELS[k]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <Tabs value={statusFilter} onValueChange={(v) => setStatusFilter(v as EventStatusFilter)}>
            <TabsList className="w-max">
              {FILTERS.map((f) => (
                <TabsTrigger key={f.value} value={f.value}>
                  {f.label}{" "}
                  <span className="tabular-nums opacity-70">{eventsQuery.status === "success" ? counts[f.value] : "–"}</span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
        {limitNotice && (
          <p className="text-xs font-medium text-amber-300">
            You can have up to {MAX_ACTIVE_EVENTS} active events — remove one to add another.
          </p>
        )}
      </GlassPanel>

      {eventsQuery.status === "loading" && <GlassSkeletonGrid />}

      {eventsQuery.status === "error" && (
        <GlassPanel className="flex flex-col items-center gap-3 py-10 text-center">
          <AlertTriangle className="h-8 w-8" style={{ color: "var(--color-primary)" }} />
          <div>
            <div className="font-semibold">Couldn&apos;t load events</div>
            <p className="text-sm text-[var(--muted-foreground)]">{eventsQuery.error?.message}</p>
          </div>
          <Button variant="glass" onClick={eventsQuery.refetch} className="gap-2">
            <RefreshCw className="h-4 w-4" /> Retry
          </Button>
        </GlassPanel>
      )}

      {eventsQuery.status === "empty" && (
        <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">
          No events found for the {season}&ndash;{season + 1} season.
        </GlassPanel>
      )}

      {eventsQuery.status === "success" &&
        (visible.length === 0 ? (
          <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">
            {search.trim() ? (
              <>
                No events match &ldquo;{search}&rdquo;
                {statusFilter !== "all" && <> in this status</>}.
              </>
            ) : (
              "No events in this status."
            )}
          </GlassPanel>
        ) : (
          groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {group.title}
                <span className="glass-pill px-2 py-0.5 text-[11px] font-medium normal-case tracking-normal tabular-nums">
                  {group.events.length}
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {group.events.map((event, i) => (
                  <motion.div key={event.code} variants={cardEntranceVariants} initial="hidden" animate="show" custom={Math.min(i, 8)}>
                    <EventCard
                      event={event}
                      status={getEventStatus(event, now)}
                      selected={activeCodes.has(event.code)}
                      isPrimary={event.code === primaryCode}
                      canEdit={isAdmin}
                      onToggle={() => toggleEvent(event)}
                    />
                  </motion.div>
                ))}
              </div>
            </section>
          ))
        ))}

      <Dialog open={!!pendingRemoval} onOpenChange={(open) => !open && setPendingRemoval(null)}>
        <DialogContent>
          <DialogTitle>Remove this active event?</DialogTitle>
          <DialogDescription>
            The team has scouted {pendingRemoval ? scoutedCount(pendingRemoval.code) : 0} entries for{" "}
            <strong>{pendingRemoval?.name}</strong>. Removing it stops it appearing in the scout form and analytics
            pickers &mdash; the data itself is kept &mdash; so make sure anything still being scouted has been
            submitted.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingRemoval(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingRemoval) commit(toggleActiveEvent(state, pendingRemoval));
                setPendingRemoval(null);
              }}
            >
              Remove event
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EventCard({
  event,
  status,
  selected,
  isPrimary,
  canEdit,
  onToggle,
}: {
  event: FtcEvent;
  status: EventLifecycleStatus;
  selected: boolean;
  isPrimary: boolean;
  canEdit: boolean;
  onToggle: () => void;
}) {
  return (
    <GlassPanel
      interactive={canEdit}
      onClick={onToggle}
      role={canEdit ? "checkbox" : undefined}
      aria-checked={canEdit ? selected : undefined}
      className={cn(
        "flex h-full flex-col gap-3 transition-shadow",
        selected && "ring-2 ring-[rgba(var(--glow),0.6)] shadow-[0_0_28px_2px_rgba(var(--glow),0.35)]"
      )}
    >
      <div className="flex items-start gap-3">
        {canEdit && (
          <span
            className={cn(
              "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
              selected ? "border-transparent" : "border-[var(--glass-border)]"
            )}
            style={selected ? { background: "var(--theme-gradient)" } : undefined}
          >
            <AnimatePresence initial={false}>
              {selected && (
                <motion.span
                  key="check"
                  initial={{ scale: 0, rotate: -45 }}
                  animate={{ scale: 1, rotate: 0 }}
                  exit={{ scale: 0 }}
                  transition={springSnappy}
                  className="flex"
                >
                  <Check className="h-3.5 w-3.5 text-[var(--color-primary-foreground)]" strokeWidth={3} />
                </motion.span>
              )}
            </AnimatePresence>
          </span>
        )}
        <h3 className="min-w-0 flex-1 font-semibold leading-snug">{event.name}</h3>
        {selected && isPrimary && (
          <Star className="mt-0.5 h-4 w-4 shrink-0 fill-current" style={{ color: "var(--color-primary)" }} aria-label="Primary event" />
        )}
        <Badge variant={STATUS_BADGE[status].variant} className="shrink-0">
          {STATUS_BADGE[status].label}
        </Badge>
      </div>
      <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> {formatDateRange(event.dateStart, event.dateEnd)}
        </span>
        {(event.city || event.stateProv) && (
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" /> {[event.city, event.stateProv].filter(Boolean).join(", ")}
          </span>
        )}
      </div>
      <span className="mt-auto text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">{event.code}</span>
    </GlassPanel>
  );
}

function MatchTypeBadge({ label, query }: { label: "Qualification" | "Playoff"; query: ReturnType<typeof useFtcQuery<FtcMatch[]>> }) {
  if (query.status === "loading") return <Badge variant="glass">{label}: loading…</Badge>;
  if (query.status === "error") return <Badge variant="danger">{label}: unavailable</Badge>;

  const matchList = query.data ?? [];
  if (matchList.length === 0) return <Badge variant="outline">{label}: not scheduled yet</Badge>;

  const played = matchList.filter((m) => m.played).length;
  if (played === 0) return <Badge variant="glass">{label}: {matchList.length} scheduled</Badge>;
  if (played < matchList.length) {
    return (
      <Badge variant="success">
        {label}: live ({played}/{matchList.length})
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      {label}: completed ({matchList.length})
    </Badge>
  );
}

function ActiveEventSummary({ event, now }: { event: FtcEvent; now: number }) {
  const teamsQuery = useFtcQuery(`teams:${event.code}:${event.season}`, () =>
    getTeamsForEvent(event.code, event.season)
  );
  const qualQuery = useFtcQuery(`matches:${event.code}:${event.season}:Qualification`, () =>
    getMatchesForEvent(event.code, "Qualification", event.season)
  );
  const playoffQuery = useFtcQuery(`matches:${event.code}:${event.season}:Playoff`, () =>
    getMatchesForEvent(event.code, "Playoff", event.season)
  );

  const teamCount =
    teamsQuery.status === "success" || teamsQuery.status === "empty" ? teamsQuery.data?.length ?? 0 : null;
  const status = STATUS_BADGE[getEventStatus(event, now)];

  return (
    <motion.div
      initial={{ boxShadow: "0 0 48px 6px rgba(var(--glow), 0.55)" }}
      animate={{ boxShadow: "0 0 0px 0px rgba(var(--glow), 0)" }}
      transition={{ duration: 1, ease: "easeOut" }}
      className="rounded-[28px]"
    >
      <GlassPanel strong className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <CheckCircle2 className="h-5 w-5 shrink-0" style={{ color: "var(--color-primary)" }} />
          <h2 className="text-lg font-semibold">{event.name}</h2>
          <Badge variant={status.variant}>{status.label}</Badge>
          <Badge variant="outline">Primary</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-[var(--muted-foreground)]">
          <span className="flex items-center gap-1.5">
            <Clock className="h-3.5 w-3.5" /> {formatDateRange(event.dateStart, event.dateEnd)}
          </span>
          {(event.city || event.stateProv) && (
            <span className="flex items-center gap-1.5">
              <MapPin className="h-3.5 w-3.5" /> {[event.city, event.stateProv, event.country].filter(Boolean).join(", ")}
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" /> {teamCount === null ? "…" : teamCount} teams
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">Practice: not tracked by FIRST API</Badge>
          <MatchTypeBadge label="Qualification" query={qualQuery} />
          <MatchTypeBadge label="Playoff" query={playoffQuery} />
        </div>
      </GlassPanel>
    </motion.div>
  );
}
