"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "framer-motion";
import { CalendarX2, Eye, History, RotateCcw, Search, TriangleAlert, X } from "lucide-react";
import { PickBoard } from "@/components/pick-list/pick-board";
import { ColumnSettings } from "@/components/pick-list/column-settings";
import { OurTeamCard } from "@/components/pick-list/our-team-card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useAnalyticsData, useAnalyticsEntries, useSingleEvent } from "@/lib/analytics/data-context";
import { useAnalyticsFilters, useSingleEventMode } from "@/lib/analytics/filter-context";
import { buildAllTeamStats } from "@/lib/analytics/team-stats";
import { useEventMatches, useEventRankingsStatus, useEventTeams } from "@/lib/analytics/use-event-data";
import { useAuth } from "@/lib/auth";
import { computeEpa, epaMatchesFromOfficial } from "@/lib/epa";
import { buildPickBoard, pickRowMatches, PICK_SORTS, sortPickRows, type PickSortKey } from "@/lib/pick-list/rows";
import { useEpaMode, usePickList } from "@/lib/pick-list/store";
import { usePermissions } from "@/lib/permissions";
import { spring } from "@/lib/motion";
import { useActiveFieldTeam, useFieldTeams } from "@/lib/field-teams-context";
import { fieldTeamFullLabel, fieldTeamLabel } from "@/lib/field-teams";

export default function PickListPage() {
  // One event at a time — the official data (ranks, EPA) belongs to a single event — even in Practice mode.
  useSingleEventMode(true, true);

  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  // P19: "our team" starts as the FTC team this user is viewing as, and can be switched here among the
  // account's teams. The switch only changes this page (the sidebar's choice is the user's saved default).
  const { loaded: teamLoaded, fieldTeams } = useFieldTeams();
  const { activeFieldTeam } = useActiveFieldTeam();
  const [ourOverrideId, setOurOverrideId] = useState<string | null>(null);
  const ourTeam = fieldTeams.find((t) => t.id === ourOverrideId) ?? activeFieldTeam;
  const ourNumber = ourTeam?.number ?? null;
  const { can } = usePermissions();
  const canEdit = can("editPickList");

  const data = useAnalyticsData();
  const { filters } = useAnalyticsFilters();
  const { code: eventCode, event } = useSingleEvent();
  const season = event?.season ?? data.season;

  // --- official data (never touched by the accuracy filter) ---------------------------------
  const requests = useMemo(() => (eventCode ? [{ code: eventCode, season }] : []), [eventCode, season]);
  const { teams, loading: teamsLoading } = useEventTeams(requests);
  const { rankings: rankingMap, loading: rankingsLoading } = useEventRankingsStatus(requests);
  const { matches, loading: matchesLoading } = useEventMatches(requests);
  const rankings = useMemo(() => (eventCode ? (rankingMap.get(eventCode) ?? []) : []), [rankingMap, eventCode]);

  const [epaMode, setEpaMode] = useEpaMode(user?.uid ?? null);
  const showEpa = epaMode === "calculated";
  const epa = useMemo(() => (showEpa ? computeEpa(epaMatchesFromOfficial(matches)).epa : null), [showEpa, matches]);

  // --- scouted data: the shared filters, but pinned to this page's one event ----------------------
  const pinnedFilters = useMemo(
    () => ({ ...filters, events: { kind: "custom" as const, codes: eventCode ? [eventCode] : [] } }),
    [filters, eventCode]
  );
  const { entries, loaded: entriesLoaded, schema } = useAnalyticsEntries(pinnedFilters);
  const teamNames = useMemo(() => new Map(teams.map((t) => [t.teamNumber, t.nameShort])), [teams]);
  const teamStats = useMemo(() => buildAllTeamStats(entries, schema, teamNames), [entries, schema, teamNames]);

  // --- the shared, realtime board ------------------------------------------------------------
  const actor = useMemo(() => (user && profile ? { uid: user.uid, name: profile.name } : null), [user, profile]);
  const { list, picked, loaded: listLoaded, edit, error, clearError } = usePickList(teamId, eventCode, actor);

  const board = useMemo(
    () =>
      buildPickBoard({
        teamNumbers: [...teams.map((t) => t.teamNumber), ...rankings.map((r) => r.teamNumber), ...teamStats.map((s) => s.teamNumber), ...picked],
        teamNames,
        rankings,
        teamStats,
        epa,
        ourTeamNumber: ourNumber,
      }),
    [teams, rankings, teamStats, picked, teamNames, epa, ourNumber]
  );

  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<PickSortKey>("oRank");
  const [resetOpen, setResetOpen] = useState(false);

  const rowByTeam = useMemo(() => new Map(board.rows.map((r) => [r.teamNumber, r])), [board.rows]);
  const pickedRows = useMemo(() => picked.flatMap((t) => rowByTeam.get(t) ?? []), [picked, rowByTeam]);
  const availableRows = useMemo(() => {
    const taken = new Set(picked);
    return sortPickRows(
      board.rows.filter((r) => !taken.has(r.teamNumber) && pickRowMatches(r, search)),
      sort
    );
  }, [board.rows, picked, search, sort]);

  const loading = !teamLoaded || !entriesLoaded || !listLoaded || teamsLoading || rankingsLoading || (showEpa && matchesLoading);
  const sortLabel = PICK_SORTS.find((s) => s.key === sort)!.label;
  const ourRank = board.ours?.oRank ?? null;

  if (!eventCode) {
    return (
      <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <div>
          <div className="font-semibold">No event selected</div>
          <p className="text-sm text-[var(--muted-foreground)]">The Pick List plans alliance selection for one event. Set an active event, or pick one in the Event filter above.</p>
        </div>
        <Link href="/event">
          <Button variant="glass" size="sm">
            Go to Active Events
          </Button>
        </Link>
      </GlassPanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-xl font-semibold tracking-tight">Pick List</h2>
        <p className="text-sm text-[var(--muted-foreground)]">
          Plan alliance selection for {event?.name ?? eventCode}. <strong className="font-medium text-[var(--foreground)]">O.</strong> columns are official FIRST data;{" "}
          <strong className="font-medium text-[var(--foreground)]">S.</strong> columns come from our scouting and follow the filters above.
        </p>
      </div>

      {loading ? (
        <PickListSkeleton />
      ) : (
        <>
          <OurTeamCard
            teamNumber={ourNumber}
            row={board.ours}
            showEpa={showEpa}
            switcher={
              fieldTeams.length > 1 ? (
                <Select value={ourTeam?.id ?? ""} onValueChange={setOurOverrideId}>
                  <SelectTrigger className="h-10 w-48" aria-label="Which of our teams to plan for">
                    <SelectValue>{ourTeam ? fieldTeamLabel(ourTeam) : "Choose a team"}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {fieldTeams.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {fieldTeamFullLabel(t)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : null
            }
          />

          {!canEdit && (
            <div className="flex items-center gap-2 rounded-2xl border border-sky-400/30 bg-sky-500/10 px-4 py-2.5 text-xs font-medium text-sky-200">
              <Eye className="h-4 w-4 shrink-0" />
              <span>
                View only — admins, Lead Strategists, Lead Scouts, Team Coaches, and Drive Team members can edit the list. You&apos;ll still see changes the moment they&apos;re made.
              </span>
            </div>
          )}

          <Notices rankingsCount={rankings.length} ourRank={ourRank} teamsCount={teams.length} />

          <div className="flex flex-wrap items-center gap-3">
            <div className="relative min-w-52 flex-1 sm:max-w-72">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search team number or name..." className="pl-10" aria-label="Search available teams" />
            </div>
            <Select value={sort} onValueChange={(v) => setSort(v as PickSortKey)}>
              <SelectTrigger className="w-44" aria-label="Sort available teams">
                <SelectValue>Sort: {sortLabel}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PICK_SORTS.map((s) => (
                  <SelectItem key={s.key} value={s.key}>
                    {s.label}
                    <span className="ml-2 text-[11px] text-[var(--muted-foreground)]">{s.lowestFirst ? "best first" : "high first"}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <ColumnSettings epaMode={epaMode} onEpaModeChange={setEpaMode} />
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <LastEdited name={list?.updatedByName ?? null} atMs={list?.updatedAtMs ?? null} />
              {canEdit && picked.length > 0 && (
                <Button variant="outline" className="h-11 gap-2" onClick={() => setResetOpen(true)}>
                  <RotateCcw className="h-4 w-4" /> Reset list
                </Button>
              )}
            </div>
          </div>

          {error && (
            <div role="alert" className="flex items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-2.5 text-xs font-medium text-amber-300">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <span className="flex-1">{error}</span>
              <button type="button" onClick={clearError} aria-label="Dismiss" className="shrink-0 hover:text-amber-100">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <PickBoard
            availableRows={availableRows}
            pickedRows={pickedRows}
            ourRank={ourRank}
            showEpa={showEpa}
            canEdit={canEdit}
            onOp={(op) => void edit(op)}
            availableEmpty={search.trim() ? <>No teams match &ldquo;{search}&rdquo;.</> : "Every team is on the Picked list."}
          />
        </>
      )}

      <Dialog open={resetOpen} onOpenChange={setResetOpen}>
        <DialogContent>
          <DialogTitle>Reset the pick list?</DialogTitle>
          <DialogDescription>
            This empties the Picked list for everyone ({picked.length} {picked.length === 1 ? "team" : "teams"}). It&apos;s recorded in the audit log, but the order can&apos;t be restored.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setResetOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                void edit({ type: "reset" });
                setResetOpen(false);
              }}
            >
              Reset list
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Gentle explanations for the "-" values, so an empty column never looks like a bug. */
function Notices({ rankingsCount, ourRank, teamsCount }: { rankingsCount: number; ourRank: number | null; teamsCount: number }) {
  const notes: string[] = [];
  if (rankingsCount === 0) {
    notes.push("Official rankings aren't published for this event yet, so O. Rank and Pick % show “-” until qualification matches have been played.");
  } else if (ourRank === null) {
    notes.push("Our team isn't in the official rankings yet, so Pick % can't be worked out (it compares our rank to each team's).");
  }
  if (teamsCount === 0) {
    notes.push("The event's team list couldn't be loaded, so only teams with rankings or scouted data are shown.");
  }
  if (notes.length === 0) return null;
  return (
    <div className="flex flex-col gap-1 rounded-2xl border border-[var(--glass-border)] bg-white/5 px-4 py-2.5 text-xs text-[var(--muted-foreground)]">
      {notes.map((n) => (
        <p key={n}>{n}</p>
      ))}
    </div>
  );
}

/** "Last edited by X" — plays a soft pulse each time the list changes (yours or a teammate's, live). */
function LastEdited({ name, atMs }: { name: string | null; atMs: number | null }) {
  if (!name) return <span className="text-xs text-[var(--muted-foreground)]">Not edited yet</span>;
  const time = atMs ? new Date(atMs).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "just now";
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <motion.div
        key={atMs ?? "pending"}
        initial={{ opacity: 0, scale: 0.94, boxShadow: "0 0 0 0 rgba(var(--glow),0.6)" }}
        animate={{ opacity: 1, scale: 1, boxShadow: "0 0 24px 2px rgba(var(--glow),0)" }}
        transition={{ ...spring, boxShadow: { duration: 1.1, ease: "easeOut" } }}
        className="glass-pill flex items-center gap-2 px-3.5 py-2 text-xs"
        aria-live="polite"
      >
        <History className="h-3.5 w-3.5 text-[var(--muted-foreground)]" />
        Last edited by <strong className="font-semibold">{name}</strong> <span className="text-[var(--muted-foreground)]">· {time}</span>
      </motion.div>
    </AnimatePresence>
  );
}

function PickListSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy>
      <div className="glass-card h-[88px] animate-pulse" />
      <div className="flex flex-wrap gap-3">
        <div className="glass-card h-11 w-64 animate-pulse" />
        <div className="glass-card h-11 w-44 animate-pulse" />
        <div className="glass-card h-11 w-28 animate-pulse" />
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {[0, 1].map((col) => (
          <div key={col} className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="glass-card h-[112px] animate-pulse" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
