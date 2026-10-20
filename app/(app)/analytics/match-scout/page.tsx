"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarX2, Download, RefreshCw, Upload } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { AnalyticsDataTable, type SortState } from "@/components/analytics/data-table";
import { ConfigModal } from "@/components/analytics/config-modal";
import { ImportCsvDialog } from "@/components/analytics/import-csv-dialog";
import { useActiveEvent } from "@/lib/active-event";
import { GAMES, DEFAULT_GAME_ID } from "@/lib/analytics/game-schema";
import { entriesToCsv } from "@/lib/analytics/csv";
import { recomputeForEvent } from "@/lib/analytics/recompute";
import { deleteEntry, getEntriesForEvent, updateEntry, type ManualFlagReason, type ScoutEntry } from "@/lib/scout-entries";

export default function MatchScoutAnalyticsPage() {
  const { activeEvent } = useActiveEvent();

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

  const schema = GAMES[gameId] ?? GAMES[DEFAULT_GAME_ID];

  const refresh = useCallback(() => {
    if (!activeEvent) {
      setEntries([]);
      return;
    }
    setEntries(getEntriesForEvent(activeEvent.code));
  }, [activeEvent]);

  useEffect(() => {
    // Deliberately deferred to an effect: localStorage isn't available during
    // SSR, so the first render matches the server (empty) and real entries
    // sync in right after mount, same pattern as the other local data stores.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    setLoaded(true);
  }, [refresh]);

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    let i = 1;
    for (const e of entries) {
      if (!map.has(e.scoutName)) {
        map.set(e.scoutName, `Scout ${i}`);
        i++;
      }
    }
    return map;
  }, [entries]);

  const resolveDisplayName = useCallback(
    (scoutName: string) => (hideNames ? nameMap.get(scoutName) ?? scoutName : scoutName),
    [hideNames, nameMap]
  );

  const visibleEntries = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchCol = schema.columns.find((c) => c.key === "match")!;
    const filtered = q
      ? entries.filter((e) => {
          const haystack = [matchCol.getValue(e), e.teamNumber, resolveDisplayName(e.scoutName), e.comments]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        })
      : entries;

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
  }, [entries, search, sort, schema, resolveDisplayName]);

  const configEntry = configEntryId ? entries.find((e) => e.id === configEntryId) ?? null : null;

  const handleExport = () => {
    const csv = entriesToCsv(schema, visibleEntries, resolveDisplayName);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `match-scout-${activeEvent?.code ?? "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleRecalculate = async () => {
    if (!activeEvent) return;
    setRecalculating(true);
    await recomputeForEvent(activeEvent.code, activeEvent.season);
    refresh();
    setRecalculating(false);
  };

  const withEntry = (id: string, patch: (entry: ScoutEntry) => Partial<ScoutEntry>) => {
    const entry = entries.find((e) => e.id === id);
    if (!entry) return;
    updateEntry(id, patch(entry));
    refresh();
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
    withEntry(id, (e) => ({ excluded: !e.excluded }));
    if (activeEvent) void recomputeForEvent(activeEvent.code, activeEvent.season).then(refresh);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteEntry(deleteTarget.id);
    setDeleteTarget(null);
    refresh();
  };

  if (!activeEvent) {
    return (
      <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <div>
          <div className="font-semibold">No active event selected</div>
          <p className="text-sm text-[var(--muted-foreground)]">Select an event to see its match scouting data.</p>
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
          <Button variant="glass" size="sm" className="gap-2" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import CSV
          </Button>
          <Button size="sm" className="gap-2" onClick={handleRecalculate} disabled={recalculating}>
            <RefreshCw className={recalculating ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            {recalculating ? "Recalculating…" : "Recalculate Accuracy"}
          </Button>
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
      />

      {!loaded ? (
        <div className="glass-card h-64 animate-pulse" />
      ) : entries.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">
          No entries yet for this event.
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
      />

      <ImportCsvDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        schema={schema}
        eventCode={activeEvent.code}
        existingEntries={entries}
        onImported={() => {
          refresh();
          void recomputeForEvent(activeEvent.code, activeEvent.season).then(refresh);
        }}
      />

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
