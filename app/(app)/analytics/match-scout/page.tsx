"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarX2, Download, RefreshCw, Upload } from "lucide-react";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { AnalyticsDataTable, type SortState } from "@/components/analytics/data-table";
import { ConfigModal } from "@/components/analytics/config-modal";
import { ImportCsvDialog } from "@/components/analytics/import-csv-dialog";
import { useAuth } from "@/lib/auth";
import { buildGameSchema, withPracticeColumns } from "@/lib/analytics/game-schema";
import { useActiveForm, useForms } from "@/lib/forms/forms-context";
import { entriesToCsv } from "@/lib/analytics/csv";
import { recomputeForEvent } from "@/lib/analytics/recompute";
import { useAnalyticsData, useAnalyticsEntries, useSingleEvent } from "@/lib/analytics/data-context";
import { useAnalyticsFilters, useSingleEventMode } from "@/lib/analytics/filter-context";
import { setSessionExcluded } from "@/lib/scout-stats/actions";
import { downloadTextFile } from "@/lib/download";
import { deleteEntry, updateEntry, type ManualFlagReason, type ScoutEntry } from "@/lib/scout-entries";

export default function MatchScoutAnalyticsPage() {
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const searchParams = useSearchParams();

  // Game / Event / Practice now come from the shared filter bar (P10). Import
  // and Recalculate act on a single event, so this page asks the bar's Event
  // control to be a single select while it's mounted.
  useSingleEventMode();
  const { filters } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const practiceMode = filters.practice;
  const { code: eventCode, event: singleEvent } = useSingleEvent();
  const eventSeason = singleEvent?.season ?? data.season;
  const sessionsById = data.sessionsById;

  // Real-event data is pinned to the one chosen event; practice data spans events, as the filter says.
  const pinnedFilters = useMemo(
    () => (practiceMode ? filters : { ...filters, events: { kind: "custom" as const, codes: eventCode ? [eventCode] : [] } }),
    [practiceMode, filters, eventCode]
  );
  // This is the *raw* table: no accuracy filter, and excluded entries stay visible (the Config modal toggles them).
  const { scope: sourceEntries, loaded } = useAnalyticsEntries(pinnedFilters, { applyAccuracy: false, includeExcluded: true });

  // A Team Profile "open the raw entry" link arrives as ?match=Q12&team=254 — start with that search.
  const [search, setSearch] = useState(() => [searchParams.get("match"), searchParams.get("team"), searchParams.get("scout")].filter(Boolean).join(" "));
  const [autoExpand, setAutoExpand] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: "match", direction: "asc" });
  const [configEntryId, setConfigEntryId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoutEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [recalculating, setRecalculating] = useState(false);

  // P21: the table is derived from the form(s) the visible entries were scouted with; importing writes with the season's active form.
  const forms = useForms();
  const { form: importForm } = useActiveForm(filters.gameId);
  const schema = useMemo(() => (practiceMode ? withPracticeColumns(buildGameSchema(data.schema)) : buildGameSchema(data.schema)), [data.schema, practiceMode]);
  const importSchema = useMemo(() => buildGameSchema(importForm), [importForm]);

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
    const filename = practiceMode ? "match-scout-practice.csv" : `match-scout-${eventCode ?? "export"}.csv`;
    downloadTextFile(filename, csv, "text/csv;charset=utf-8");
  };

  const handleRecalculate = async () => {
    if (!eventCode || !teamId) return;
    setRecalculating(true);
    await recomputeForEvent(teamId, eventCode, eventSeason, forms.currentResolver);
    setRecalculating(false);
  };

  const withEntry = (id: string, patch: (entry: ScoutEntry) => Partial<ScoutEntry>) => {
    const entry = sourceEntries.find((e) => e.id === id);
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
      const entry = sourceEntries.find((e) => e.id === id);
      const session = entry?.sessionId ? sessionsById.get(entry.sessionId) : null;
      if (session && teamId && user && profile) void setSessionExcluded(teamId, user.uid, profile.name, session, !session.excluded);
      return;
    }
    withEntry(id, (e) => ({ excluded: !e.excluded }));
    if (eventCode && teamId) void recomputeForEvent(teamId, eventCode, eventSeason, forms.currentResolver);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    void deleteEntry(deleteTarget.id);
    setDeleteTarget(null);
  };

  if (!eventCode && !practiceMode) {
    return (
      <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <div>
          <div className="font-semibold">No event selected</div>
          <p className="text-sm text-[var(--muted-foreground)]">
            Set an active event, pick one in the Event filter above, or turn on Practice to see practice scouting data.
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
        <div className="flex flex-wrap items-center gap-2">
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
      />

      {practiceMode && <GlassPanel className="border-sky-400/20 bg-sky-500/5 text-sm text-sky-200">Showing practice scouting data.</GlassPanel>}

      {!loaded ? (
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

      {!practiceMode && teamId && user && eventCode && (
        <ImportCsvDialog
          open={importOpen}
          onOpenChange={setImportOpen}
          schema={importSchema}
          form={importForm}
          teamId={teamId}
          uid={user.uid}
          eventCode={eventCode}
          existingEntries={sourceEntries}
          onImported={() => {
            void recomputeForEvent(teamId, eventCode, eventSeason, forms.currentResolver);
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

