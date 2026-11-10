"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarX2, Download, Table2, Upload, Rows3 } from "lucide-react";
import { AnalyticsDataTable, type SortState } from "@/components/analytics/data-table";
import { ConfigModal } from "@/components/analytics/config-modal";
import { FormImportDialog } from "@/components/analytics/form-import-dialog";
import { FormSummaryView } from "@/components/analytics/form-summaries-view";
import { AnalyticsToolbar } from "@/components/analytics/toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { entriesToCsv } from "@/lib/analytics/csv";
import { useAnalyticsData } from "@/lib/analytics/data-context";
import { useAnalyticsFilters } from "@/lib/analytics/filter-context";
import { buildFormSchema, eventCodesForScope, formAnalyticsPage, selectFormEntries, type FormAnalyticsPage as PageDef, type FormAnalyticsSlug } from "@/lib/analytics/form-analytics";
import { unionForms } from "@/lib/analytics/game-schema";
import { useAuth } from "@/lib/auth";
import { downloadTextFile } from "@/lib/download";
import { adminUpdateFormEntry, deleteFormEntry, saveFormEntry, useFormEntries } from "@/lib/form-entries";
import { formEntryToRow, type FormEntry, type NewFormEntry } from "@/lib/form-entries-model";
import { getBuiltinForm } from "@/lib/forms/builtin";
import { useForms, useFormsForEntries } from "@/lib/forms/forms-context";
import type { Form } from "@/lib/forms/types";
import type { ManualFlagReason, ScoutEntry } from "@/lib/scout-entries";

type View = "table" | "summary";

export type FormAnalyticsViewProps = {
  page: PageDef;
  /** The page's form type, in the chosen events, excluded entries included. */
  entries: FormEntry[];
  /** Every form entry of the team (the Drive Reflection summary needs the Match Strategy plans). */
  allEntries: FormEntry[];
  form: Form;
  importForm: Form;
  loaded: boolean;
  /** The Event filter's codes (null = every event); empty = nothing chosen. */
  eventCodes: string[] | null;
  isAdmin: boolean;
  teamNames: ReadonlyMap<number, string>;
  /** Where Import CSV writes when the file has no Event column; null hides Import. */
  importEvent: string | null;
  initialView?: View;
  onUpdate: (id: string, patch: { excluded?: boolean; flags?: FormEntry["flags"] }) => void;
  onDelete: (id: string) => void;
  onImportSave: (input: NewFormEntry) => Promise<unknown>;
};

/**
 * One of the six form Analytics pages (P30), as a pure view: the schema-driven raw table (the same table Match Scout Analytics uses) and a summary view, for the
 * entries of one form type. Everyone can read; only admins flag, exclude, delete and import (the rules say the same).
 */
export function FormAnalyticsView({ page, entries, allEntries, form, importForm, loaded, eventCodes, isAdmin, teamNames, importEvent, initialView = "table", onUpdate, onDelete, onImportSave }: FormAnalyticsViewProps) {
  const multiEvent = eventCodes === null || eventCodes.length > 1;
  const baseSchema = useMemo(() => buildFormSchema(form, { multiEvent, page }), [form, multiEvent, page]);
  // the Actions column (Config, Delete) is for admins only
  const schema = useMemo(() => (isAdmin ? baseSchema : { ...baseSchema, columns: baseSchema.columns.filter((c) => c.type !== "actions") }), [baseSchema, isAdmin]);
  const importSchema = useMemo(() => buildFormSchema(importForm, { multiEvent, page }), [importForm, multiEvent, page]);

  const rows = useMemo(() => entries.map((e) => formEntryToRow(e, form)), [entries, form]);
  const entryById = useMemo(() => new Map(entries.map((e) => [e.id, e])), [entries]);

  const [view, setView] = useState<View>(initialView);
  const [search, setSearch] = useState("");
  const [autoExpand, setAutoExpand] = useState(false);
  const [hideNames, setHideNames] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: page.hasMatch ? "match" : "team", direction: "asc" });
  const [configId, setConfigId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScoutEntry | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const nameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of rows) if (!map.has(e.scoutName)) map.set(e.scoutName, `Scout ${map.size + 1}`);
    return map;
  }, [rows]);
  const displayName = useCallback((name: string) => (hideNames ? (nameMap.get(name) ?? name) : name), [hideNames, nameMap]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q ? rows.filter((r) => schema.columns.some((c) => c.type !== "actions" && String(c.type === "scoutName" ? displayName(r.scoutName) : (c.getValue(r) ?? "")).toLowerCase().includes(q))) : rows;
    const col = schema.columns.find((c) => c.key === sort.key);
    if (!col) return filtered;
    const dir = sort.direction === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      const av = col.getSortValue ? col.getSortValue(a) : (col.getValue(a) as string | number | null);
      const bv = col.getSortValue ? col.getSortValue(b) : (col.getValue(b) as string | number | null);
      if (av === null || av === undefined) return 1;
      if (bv === null || bv === undefined) return -1;
      return av < bv ? -dir : av > bv ? dir : 0;
    });
  }, [rows, search, sort, schema, displayName]);

  // the summaries read the entries behind the visible rows (so search and Hide Names apply), never the excluded ones
  const summaryEntries = useMemo(() => visible.map((r) => entryById.get(r.id)).filter((e): e is FormEntry => !!e && !e.excluded), [visible, entryById]);
  const configRow = configId ? (rows.find((r) => r.id === configId) ?? null) : null;

  const exportCsv = () => {
    const csv = entriesToCsv(schema, visible, displayName);
    downloadTextFile(`${page.slug}-${eventCodes === null ? "all-events" : eventCodes.join("-") || "export"}.csv`, csv, "text/csv;charset=utf-8");
  };

  const patchFlags = (id: string, change: (flags: FormEntry["flags"]) => FormEntry["flags"]) => {
    const e = entryById.get(id);
    if (e) onUpdate(id, { flags: change(e.flags) });
  };

  if (eventCodes !== null && eventCodes.length === 0 && loaded) {
    return (
      <GlassPanel className="flex flex-col items-center gap-3 py-12 text-center">
        <CalendarX2 className="h-8 w-8 text-[var(--muted-foreground)]" />
        <div>
          <div className="font-semibold">No event selected</div>
          <p className="text-sm text-[var(--muted-foreground)]">Set an active event or pick one in the Event filter above.</p>
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
    <div className="flex flex-col gap-4" data-testid={`form-analytics-${page.slug}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{page.title}</h2>
          <p className="text-sm text-[var(--muted-foreground)]">{page.description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Tabs value={view} onValueChange={(v) => setView(v as View)}>
            <TabsList className="h-10" aria-label="View">
              <TabsTrigger value="table" className="gap-1.5" data-testid="view-table">
                <Table2 className="h-4 w-4" aria-hidden /> Table
              </TabsTrigger>
              <TabsTrigger value="summary" className="gap-1.5" data-testid="view-summary">
                <Rows3 className="h-4 w-4" aria-hidden /> Summary
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Button variant="glass" size="sm" className="gap-2" onClick={exportCsv} data-testid="export-csv">
            <Download className="h-4 w-4" /> Export CSV
          </Button>
          {isAdmin && importEvent && (
            <Button variant="glass" size="sm" className="gap-2" onClick={() => setImportOpen(true)} data-testid="import-csv">
              <Upload className="h-4 w-4" /> Import CSV
            </Button>
          )}
        </div>
      </div>

      <AnalyticsToolbar entryCount={visible.length} search={search} onSearchChange={setSearch} autoExpand={autoExpand} onAutoExpandChange={setAutoExpand} hideNames={hideNames} onHideNamesChange={setHideNames} />

      {!loaded ? (
        <div className="glass-card h-64 animate-pulse" data-testid="analytics-skeleton" />
      ) : entries.length === 0 ? (
        <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]" data-testid="analytics-empty">
          No {page.navLabel} entries yet for {eventCodes === null ? "any event" : eventCodes.length === 1 ? "this event" : "these events"}.
        </GlassPanel>
      ) : view === "table" ? (
        visible.length === 0 ? (
          <GlassPanel className="py-12 text-center text-sm text-[var(--muted-foreground)]">Nothing matches that search.</GlassPanel>
        ) : (
          <AnalyticsDataTable
            schema={schema}
            entries={visible}
            hideNames={hideNames}
            nameMap={nameMap}
            autoExpandNotes={autoExpand}
            sort={sort}
            onSortChange={setSort}
            onOpenConfig={isAdmin ? (e) => setConfigId(e.id) : undefined}
            onDelete={isAdmin ? setDeleteTarget : undefined}
          />
        )
      ) : (
        <FormSummaryView page={page} form={form} entries={summaryEntries} allEntries={allEntries} teamNames={teamNames} hideNames={hideNames} />
      )}

      {isAdmin && (
        <ConfigModal
          entry={configRow}
          open={!!configId}
          onOpenChange={(o) => !o && setConfigId(null)}
          onDismissAutoFlags={() => undefined}
          onAddManualFlag={(id, reason: ManualFlagReason, note) => patchFlags(id, (flags) => [...flags, { id: `mf-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, reason, ...(note ? { note } : {}), addedAt: new Date().toISOString() }])}
          onRemoveManualFlag={(id, flagId) => patchFlags(id, (flags) => flags.filter((f) => f.id !== flagId))}
          onToggleExclude={(id) => {
            const e = entryById.get(id);
            if (e) onUpdate(id, { excluded: !e.excluded });
          }}
        />
      )}

      {isAdmin && importEvent && <FormImportDialog open={importOpen} onOpenChange={setImportOpen} schema={importSchema} form={importForm} save={onImportSave} defaultEvent={importEvent} existing={entries} />}

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <DialogContent>
          <DialogTitle>Delete this entry?</DialogTitle>
          <DialogDescription>
            This permanently removes {deleteTarget?.teamNumber ? `the entry for team ${deleteTarget.teamNumber}` : "this entry"} by {deleteTarget?.scoutName}. This can&apos;t be undone.
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              data-testid="confirm-delete"
              onClick={() => {
                if (deleteTarget) onDelete(deleteTarget.id);
                setDeleteTarget(null);
              }}
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** The connected page: the team's live form entries, the Event filter, the forms catalogue and the signed-in person's rights. */
export function FormAnalyticsPage({ slug }: { slug: FormAnalyticsSlug }) {
  const page = formAnalyticsPage(slug)!;
  const { user, profile } = useAuth();
  const teamId = profile?.teamId ?? null;
  const isAdmin = profile?.isAdmin ?? false;
  const searchParams = useSearchParams();
  const { filters, setFilters } = useAnalyticsFilters();
  const data = useAnalyticsData();
  const forms = useForms();

  // these pages have no Practice mode: a Practice filter carried over from another page is switched off
  const practiceOn = filters.practice;
  useEffect(() => {
    if (practiceOn) setFilters({ practice: false, events: { kind: "active" } }, "replace");
  }, [practiceOn, setFilters]);

  const { entries: all, loaded } = useFormEntries(teamId);
  const eventCodes = useMemo(() => eventCodesForScope(filters.events, data.activeEventCodes), [filters.events, data.activeEventCodes]);
  const scope = useMemo(() => selectFormEntries(all, page.formType, eventCodes, { includeExcluded: true }), [all, page.formType, eventCodes]);

  // the form the shown entries were filled in with (every version of every form of this type, unioned), or the built-in while there are none
  const { forms: usedForms } = useFormsForEntries(scope);
  const form: Form = useMemo(() => (usedForms.length > 0 ? unionForms(usedForms) : (forms.latest(page.formId) ?? getBuiltinForm(page.formId)!)), [usedForms, forms, page.formId]);
  const importForm: Form = forms.latest(page.formId) ?? getBuiltinForm(page.formId)!;
  const importEvent = eventCodes && eventCodes.length === 1 ? eventCodes[0] : (data.primaryCode ?? data.activeEventCodes[0] ?? null);

  return (
    <FormAnalyticsView
      page={page}
      entries={scope}
      allEntries={all}
      form={form}
      importForm={importForm}
      loaded={loaded && data.loaded}
      eventCodes={eventCodes}
      isAdmin={isAdmin}
      teamNames={data.teamNames}
      importEvent={importEvent}
      initialView={searchParams.get("view") === "summary" ? "summary" : "table"}
      onUpdate={(id, patch) => void adminUpdateFormEntry(id, patch)}
      onDelete={(id) => void deleteFormEntry(id)}
      onImportSave={(input) => (teamId && user ? saveFormEntry(teamId, user.uid, input) : Promise.reject(new Error("Not signed in.")))}
    />
  );
}
