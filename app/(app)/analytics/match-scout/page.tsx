"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarX2, Download, RefreshCw, Upload } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { PracticeFilters, type PracticeModeFilter, type PracticeSourceFilter } from "@/components/analytics/practice-filters";
import { AnalyticsDataTable, type SortState } from "@/components/analytics/data-table";
import { ConfigModal } from "@/components/analytics/config-modal";
import { ImportCsvDialog } from "@/components/analytics/import-csv-dialog";
import { useActiveEvent } from "@/lib/active-event";
import { useAuth } from "@/lib/auth";
import { GAMES, DEFAULT_GAME_ID, withPracticeColumns } from "@/lib/analytics/game-schema";
import { entriesToCsv } from "@/lib/analytics/csv";
import { recomputeForEvent } from "@/lib/analytics/recompute";
import { useAllLibraryMatches } from "@/lib/match-library";
import { useAllTeamPracticeSessions } from "@/lib/practice-sessions";
import { setSessionExcluded } from "@/lib/scout-stats/actions";
import { downloadTextFile } from "@/lib/download";
import {
  deleteEntry,
  subscribeEntries,
  updateEntry,
  useTeamScoutEntries,
  type ManualFlagReason,
  type ScoutEntry,
} from "@/lib/scout-entries";

export default function MatchScoutAnalyticsPage() {
  const { activeEvent } = useActiveEvent();
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;

  const [loaded, setLoaded] = useState(false);
  const [entries, setEntries] = useState<ScoutEntry[]>([]);
  const [gameId, setGameId] = useState(DEFAULT_GAME_ID);
  const [search, setSearch] = useState("");
  const [autoExpand, setAutoExpand] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "match", direction: "asc" });
  const [configEntryId, setConfigEntryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoutEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  const [practiceMode, setPracticeMode] = useState(false);
  const [practiceModeFilter, setPracticeModeFilter] = useState<PracticeModeFilter>("all");
  const [practiceSourceFilter, setPracticeSourceFilter] = useState<PracticeSourceFilter>("all");
  const [practiceEventCodes, setPracticeEventCodes] = useState<string[]>([]);

  const schema = withSchemaForMode(gameId, practiceMode);

  const { entries: teamEntries, loaded: teamEntriesLoaded } = useTeamScoutEntries(practiceMode ? teamId : null);
  const { sessions: allSessions, loaded: sessionsLoaded } = useAllTeamPracticeSessions(practiceMode ? teamId : null);
  const { matches: libraryMatches } = useAllLibraryMatches();
  const practiceLoaded = teamEntriesLoaded && sessionsLoaded;

  useEffect(() => {
    if (!teamId || !activeEvent) {
      // Deliberate: clears stale entries from a previous team/event once
      // either becomes unavailable, rather than leaving them on screen.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setEntries([]);
      setLoaded(true);
      return;
    }
    setLoaded(false);
    const unsubscribe = subscribeEntries(teamId, activeEvent.code, (next) => {
      setEntries(next);
      setLoaded(true);
    });
    return unsubscribe;
  }, [teamId, activeEvent]);

  const sessionsById = useMemo(() => new Map(allSessions.map((s) => [s.id, s])), [allSessions]);

  const practiceEvents = useMemo(() => {
    const byCode = new Map<string, string>();
    for (const m of libraryMatches) byCode.set(m.eventCode, m.eventName);
    return [...byCode.entries()].map(([code, name]) => ({ code, name }));
  }, [libraryMatches]);

  const practiceEntries = useMemo(() => {
    const pool = teamEntries.filter((e) => e.source !== "event");
    return pool.filter((e) => {
      if (practiceModeFilter !== "all" && e.mode !== practiceModeFilter) return false;
      if (practiceSourceFilter !== "all" && e.source !== practiceSourceFilter) return false;
      if (practiceEventCodes.length > 0 && !practiceEventCodes.includes(e.eventCode)) return false;
      return true;
    });
  }, [teamEntries, practiceModeFilter, practiceSourceFilter, practiceEventCodes]);

  // Session accuracy stands in for entry accuracy here — practice/live
  // scoring is computed per-session (both robots), never on the entry
  // itself (see docs/ASSUMPTIONS.md, P9). A shallow display-only copy, never
  // written back.
  const practiceDisplayEntries = useMemo(
    () =>
      practiceEntries.map((e) => {
        const session = e.sessionId ? sessionsById.get(e.sessionId) : null;
        if (!session || session.accuracy === null) return { ...e, accuracy: null };
        return {
          ...e,
          accuracy: {
            status: "complete" as const,
            value: session.accuracy / 100,
            scoutedTotal: session.scoutedTotal,
            penaltyPoints: session.penaltyPoints,
            officialScore: session.officialScore,
          },
        };
      }),
    [practiceEntries, sessionsById]
  );

  const sourceEntries = practiceMode ? practiceDisplayEntries : entries;

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    let i = 1;
    for (const e of sourceEntries) {
      if (!map.has(e.scoutName)) {
        map.set(e.scoutName, `Scout ${i}`);
        i++;
      }
    }
    return map;
  }, [sourceEntries]);

  const resolveDisplayName = useCallback(
    (scoutName: string) => (hideNames ? nameMap.get(scoutName) ?? scoutName : scoutName),
    [hideNames, nameMap]
  );

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchCol = schema.columns.find((c) => c.key === "match")!;
    const filtered = q
      ? sourceEntries.filter((e) => {
          const haystack = [matchCol.getValue(e), e.teamNumber, resolveDisplayName(e.scoutName), e.comments]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        })
      : sourceEntries;

    const col = schema.columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.getSortValue ? col.getSortValue(a) : col.getValue(a);
      const bv = col.getSortValue ? col.getSortValue(b) : col.getValue(b);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      if (av < bv) return -1 * dir;
      if (av > bv) return 1 * dir;
      return 0;
    });
  }, [sourceEntries, search, sort, schema, resolveDisplayName]);

  const configEntry = configEntryId ? sourceEntries.find((e) => e.id === configEntryId) ?? null : null;
  const configSession = practiceMode && configEntry?.sessionId ? sessionsById.get(configEntry.sessionId) ?? null : null;

  const handleExport = () => {
    const csv = entriesToCsv(schema, visibleEntries, resolveDisplayName);
    const filename = practiceMode ? "match-scout-practice.csv" : `match-scout-${activeEvent?.code ?? "export"}.csv`;
    downloadTextFile(filename, csv, "text/csv;charset=utf-8");
  };

  const handleRecalculate = async () => {
    if (!activeEvent || !teamId) return;
    setRecalculating(true);
    await recomputeForEvent(teamId, activeEvent.code, activeEvent.season);
    setRecalculating(false);
  };

  const withEntry = (id: string, patch: (entry: ScoutEntry) => Partial<ScoutEntry>) => {
    const entry = (practiceMode ? practiceEntries : entries).find((e) => e.id === id);
    if (!entry) return;
    void updateEntry(id, patch(entry));
  };

  const handleDismissAutoFlags = (id: string) =>
    withEntry(id, (e) => ({ autoFlags: e.autoFlags.map((f) => ({ ...f, dismissed: true })) }));

  const handleAddManualFlag = (id: string, reason: ManualFlagReason, note?: string) =>
    withEntry(id, (e) => ({
      manualFlags: [...e.manualFlags, { id: `mf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, reason, note, addedAt: new Date().toISOString() }],
    }));

  const handleRemoveManualFlag = (id: string, flagId: string) =>
    withEntry(id, (e) => ({ manualFlags: e.manualFlags.filter((f) => f.id !== flagId) }));

  const handleToggleExclude = (id: string) => {
    if (practiceMode) {
      const entry = practiceEntries.find((e) => e.id === id);
      const session = entry?.sessionId ? sessionsById.get(entry.sessionId) : null;
      if (session && teamId && user && profile) void setSessionExcluded(teamId, user.uid, profile.name, session, !session.excluded);
      return;
    }
    withEntry(id, (e) => ({ excluded: !e.excluded }));
    if (activeEvent && teamId) void recomputeForEvent(teamId, activeEvent.code, activeEvent.season);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    void deleteEntry(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (!activeEvent && !practiceMode) {
    return (
      <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <div>
          <div className="font-semibold">No active event selected</div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Select an event to see its match scouting data, or check &ldquo;Practice Scouted Matches&rdquo; below.
          </p>
        </div>
        <Link href="/event">
          <Button variant="glass" size="sm">
            Go to Active Event
          </Button>
        </Link>
      </GlassPanel>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">Match Analytics</h2>
          <p className="text-sm text-[var(--muted-foreground)]">Match scouting breakdown with sticky match/team columns.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="glass" size="sm" className="gap-2" onClick={handleExport}>
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          {!practiceMode && (
            <>
              <Button variant="glass" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" /> Import CSV
              </Button>
              <Button size="sm" className="gap-2" onClick={handleRecalculate} disabled={recalculating}>
                <RefreshCw className={recalculating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
                {recalculating ? "Recalculating…" : "Recalculate Accuracy"}
              </Button>
            </>
          )}
        </div>
      </div>

      <AnalyticsToolbar
        entryCount={visibleEntries.length}
        search={search}
        onSearchChange={setSearch}
        autoExpand={autoExpand}
        onAutoExpandChange={setAutoExpand}
        hideNames={hideNames}
        onHideNamesChange={setHideNames}
        gameId={gameId}
        onGameChange={setGameId}
        practiceMode={practiceMode}
        onPracticeModeChange={setPracticeMode}
      />

      {practiceMode && (
        <>
          <GlassPanel className="border-sky-400/20 bg-sky-500/5 text-sm text-sky-200">Showing practice scouting data.</GlassPanel>
          <PracticeFilters
            mode={practiceModeFilter}
            onModeChange={setPracticeModeFilter}
            source={practiceSourceFilter}
            onSourceChange={setPracticeSourceFilter}
            events={practiceEvents}
            selectedEventCodes={practiceEventCodes}
            onToggleEvent={(code) =>
              setPracticeEventCodes((codes) => (codes.includes(code) ? codes.filter((c) => c !== code) : [...codes, code]))
            }
          />
        </>
      )}

      {(practiceMode ? !practiceLoaded : !loaded) ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : visibleEntries.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          {practiceMode ? "No practice/live entries match these filters." : "No entries yet for this event."}
        </GlassPanel>
      ) : (
        <AnalyticsDataTable
          schema={schema}
          entries={visibleEntries}
          hideNames={hideNames}
          nameMap={nameMap}
          autoExpandNotes={autoExpand}
          sort={sort}
          onSortChange={setSort}
          onOpenConfig={(e) => setConfigEntryId(e.id)}
          onDelete={setDeleteTarget}
        />
      )}

      <ConfigModal
        entry={configEntry}
        open={!!configEntryId}
        onOpenChange={(open) => !open && setConfigEntryId(null)}
        onDismissAutoFlags={handleDismissAutoFlags}
        onAddManualFlag={handleAddManualFlag}
        onRemoveManualFlag={handleRemoveManualFlag}
        onToggleExclude={handleToggleExclude}
        sessionExcluded={practiceMode ? (configSession?.excluded ?? false) : undefined}
        onToggleSessionExclude={configEntry ? () => handleToggleExclude(configEntry.id) : undefined}
      />

      {!practiceMode && teamId && user && activeEvent && (
        <ImportCsvDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          schema={schema}
          teamId={teamId}
          uid={user.uid}
          eventCode={activeEvent.code}
          existingEntries={entries}
          onImported={() => {
            void recomputeForEvent(teamId, activeEvent.code, activeEvent.season);
          }}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogTitle>Delete this entry?</DialogTitle>
          <DialogDescription>
            This permanently removes the scouting record for Team {deleteTarget?.teamNumber} on this match. This can&apos;t
            be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={confirmDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function withSchemaForMode(gameId: string, practiceMode: boolean) {
  const base = GAMES[gameId] ?? GAMES[DEFAULT_GAME_ID];
  return practiceMode ? withPracticeColumns(base) : base;
}
