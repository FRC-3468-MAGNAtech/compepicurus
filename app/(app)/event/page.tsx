"use client";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, CheckCircle2, Clock, MapPin, RefreshCw, Users } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { GlassSkeletonGrid } from "@/components/ui/glass-skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useActiveEvent } from "@/lib/active-event";
import { useFtcQuery } from "@/lib/ftc/use-ftc-query";
import { getEvents, getMatchesForEvent, getTeamsForEvent } from "@/lib/ftc/actions";
import { getDefaultSeason, getSelectableSeasons } from "@/lib/ftc/config";
import { cardEntranceVariants } from "@/lib/motion";
import { cn } from "@/lib/utils";
import type { FtcEvent, FtcMatch } from "@/lib/ftc/types";

const STATUS_BADGE: Record<FtcEvent["status"], { label: string; variant: "success" | "glass" | "outline" }> = {
  "in-progress": { label: "In progress", variant: "success" },
  upcoming: { label: "Upcoming", variant: "glass" },
  completed: { label: "Completed", variant: "outline" },
};

function formatDateRange(start: string, end: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  const s = new Date(start).toLocaleDateString(undefined, opts);
  const e = new Date(end).toLocaleDateString(undefined, opts);
  return start === end ? s : `${s} – ${e}`;
}

export default function EventSelectionPage() {
  const { activeEvent, setActiveEvent } = useActiveEvent();
  const seasons = useMemo(() => getSelectableSeasons(), []);
  const [season, setSeason] = useState(() => getDefaultSeason());
  const [search, setSearch] = useState("");
  const [pendingEvent, setPendingEvent] = useState<FtcEvent | null>(null);

  const eventsQuery = useFtcQuery(`events:${season}`, () => getEvents({ season }));

  const filteredEvents = useMemo(() => {
    const list = eventsQuery.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => e.name.toLowerCase().includes(q) || e.code.toLowerCase().includes(q));
  }, [eventsQuery.data, search]);

  const selectEvent = (event: FtcEvent) => {
    if (activeEvent && activeEvent.code !== event.code) {
      setPendingEvent(event);
      return;
    }
    setActiveEvent(event);
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Active Event</h1>
        <p className="text-sm text-[var(--muted-foreground)]">
          Pick the event the team is scouting right now &mdash; every other page reads from this.
        </p>
      </div>

      {activeEvent && <ActiveEventSummary key={activeEvent.code} event={activeEvent} />}

      <GlassPanel className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events by name or code..."
          className="flex-1"
        />
        <Select value={String(season)} onValueChange={(v) => setSeason(Number(v))}>
          <SelectTrigger className="sm:w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {seasons.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}&ndash;{s + 1}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        (filteredEvents.length === 0 ? (
          <GlassPanel className="py-10 text-center text-sm text-[var(--muted-foreground)]">
            No events match &ldquo;{search}&rdquo;.
          </GlassPanel>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filteredEvents.map((event, i) => (
              <motion.div key={event.code} variants={cardEntranceVariants} initial="hidden" animate="show" custom={i}>
                <GlassPanel
                  interactive
                  onClick={() => selectEvent(event)}
                  className={cn(
                    "flex h-full flex-col gap-3",
                    activeEvent?.code === event.code && "ring-2 ring-[rgba(var(--glow),0.6)]"
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold leading-snug">{event.name}</h3>
                    <Badge variant={STATUS_BADGE[event.status].variant} className="shrink-0">
                      {STATUS_BADGE[event.status].label}
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
                  <span className="mt-auto text-[11px] uppercase tracking-wide text-[var(--muted-foreground)]">
                    {event.code}
                  </span>
                </GlassPanel>
              </motion.div>
            ))}
          </div>
        ))}

      <Dialog open={!!pendingEvent} onOpenChange={(open) => !open && setPendingEvent(null)}>
        <DialogContent>
          <DialogTitle>Switch active event?</DialogTitle>
          <DialogDescription>
            You&apos;re currently set to <strong>{activeEvent?.name}</strong>. Switching to{" "}
            <strong>{pendingEvent?.name}</strong> immediately changes what every page in the app reads as
            the active event &mdash; make sure anything you were scouting for the current event has
            already been submitted.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setPendingEvent(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => {
                if (pendingEvent) setActiveEvent(pendingEvent);
                setPendingEvent(null);
              }}
            >
              Switch event
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
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

function ActiveEventSummary({ event }: { event: FtcEvent }) {
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
          <Badge variant={STATUS_BADGE[event.status].variant}>{STATUS_BADGE[event.status].label}</Badge>
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
