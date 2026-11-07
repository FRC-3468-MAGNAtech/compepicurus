"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { GitCommitVertical, Plus, Search, X } from "lucide-react";
import { EntryCard } from "@/components/changelog/entry-card";
import { EntryEditor } from "@/components/changelog/entry-editor";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import { useAuth } from "@/lib/auth";
import {
  CHANGE_TYPES,
  countByType,
  emptyDraft,
  entryLabel,
  entryToDraft,
  filterEntries,
  initiallyExpanded,
  latestPublishedMs,
  localIsoDate,
  type ChangeType,
  type ChangelogDraft,
  type ChangelogEntry,
} from "@/lib/changelog";
import { deleteEntry, markChangelogSeen, patchEntry, seedChangelogIfNeeded, useAsyncAction, useChangelog } from "@/lib/changelog/store";
import { usePermissions } from "@/lib/permissions";
import { cn } from "@/lib/utils";

type EditorState = { key: number; entryId: string | null; initial: ChangelogDraft };

export default function ChangelogPage() {
  const { user, profile } = useAuth();
  const { isAdmin } = usePermissions();
  const teamId = profile?.teamId ?? null;
  const { entries, loaded } = useChangelog(teamId, isAdmin);
  const actor = useMemo(() => (user && profile && teamId ? { teamId, uid: user.uid, name: profile.name } : null), [user, profile, teamId]);

  const [types, setTypes] = useState<ChangeType[]>([]);
  const [query, setQuery] = useState("");
  // Per-card open/closed choices the reader has made; anything not here follows the default below.
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  const [editor, setEditor] = useState<EditorState | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const editorKey = useRef(0);
  const [deleting, setDeleting] = useState<ChangelogEntry | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const rowAction = useAsyncAction();
  const deleteAction = useAsyncAction();

  // First admin visit creates the starter drafts (guarded by a marker on the team doc, so it only ever happens once).
  const seededRef = useRef(false);
  useEffect(() => {
    if (!isAdmin || !actor || !loaded || seededRef.current) return;
    seededRef.current = true;
    seedChangelogIfNeeded(actor).catch((err) => console.error("couldn't seed the starter changelog drafts:", err));
  }, [isAdmin, actor, loaded]);

  // Opening the page clears the nav dot — and so does something being published while you're looking at it.
  const latestPublished = useMemo(() => latestPublishedMs(entries), [entries]);
  const stampedFor = useRef<number | null | undefined>(undefined);
  const uid = user?.uid ?? null;
  useEffect(() => {
    if (!uid || !loaded || stampedFor.current === latestPublished) return;
    stampedFor.current = latestPublished;
    void markChangelogSeen(uid);
  }, [uid, loaded, latestPublished]);

  const filterActive = types.length > 0 || query.trim() !== "";
  const displayed = useMemo(() => filterEntries(entries, { types, query }), [entries, types, query]);
  const counts = useMemo(() => countByType(entries), [entries]);
  const draftCount = entries.filter((e) => e.status === "draft").length;
  // Newest two start open and the rest collapsed; while filtering or searching, every match opens so the hit is visible.
  const defaults = useMemo(() => (filterActive ? new Set(displayed.map((e) => e.id)) : initiallyExpanded(entries)), [filterActive, displayed, entries]);
  const isExpanded = (id: string) => overrides[id] ?? defaults.has(id);
  const setAll = (open: boolean) => setOverrides((o) => ({ ...o, ...Object.fromEntries(displayed.map((e) => [e.id, open])) }));

  const toggleType = (t: ChangeType) => setTypes((cur) => (cur.includes(t) ? cur.filter((x) => x !== t) : [...cur, t]));

  const openEditor = (entry: ChangelogEntry | null) => {
    editorKey.current += 1;
    setEditor({ key: editorKey.current, entryId: entry?.id ?? null, initial: entry ? entryToDraft(entry) : emptyDraft(localIsoDate(new Date())) });
    setEditorOpen(true);
  };

  const confirmDelete = async () => {
    if (!actor || !deleting) return;
    const ok = await deleteAction.run(() => deleteEntry(actor, deleting.id), "Couldn't delete the entry. Check your connection and try again.");
    if (ok) setDeleteOpen(false);
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Changelog</h1>
          <p className="text-sm text-[var(--muted-foreground)]">What&apos;s new, improved, and fixed.</p>
        </div>
        {isAdmin && (
          <Button onClick={() => openEditor(null)} disabled={!actor}>
            <Plus className="h-4 w-4" /> New entry
          </Button>
        )}
      </div>

      {/* The filter bar is always rendered, so nothing jumps when the entries arrive. */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-md">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
          <Input aria-label="Search the changelog" className="pl-10 pr-10" placeholder="Search versions, titles, and changes" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-[var(--muted-foreground)] hover:bg-white/10 hover:text-[var(--foreground)]">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setTypes([])}
            aria-pressed={types.length === 0}
            className={cn("rounded-full border px-3.5 py-1 text-xs font-semibold transition-colors", types.length === 0 ? "border-transparent bg-white/15 text-[var(--foreground)]" : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:bg-white/6")}
          >
            All
          </button>
          {CHANGE_TYPES.map((t) => {
            const on = types.includes(t.id);
            return (
              <button key={t.id} type="button" onClick={() => toggleType(t.id)} aria-pressed={on} className={cn("rounded-full px-3.5 py-1 text-xs font-semibold transition-[opacity,box-shadow]", t.pill, on ? "shadow-[0_0_16px_1px_rgba(var(--glow),0.45)]" : "opacity-60 hover:opacity-100")}>
                {t.label} <span className={cn("opacity-70 transition-opacity", !loaded && "opacity-0")}>{counts[t.id]}</span>
              </button>
            );
          })}
          <span className="mx-1 hidden h-4 w-px bg-[var(--glass-border)] sm:block" aria-hidden />
          <Button variant="ghost" size="sm" onClick={() => setAll(true)} disabled={displayed.length === 0}>
            Expand all
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)} disabled={displayed.length === 0}>
            Collapse all
          </Button>
        </div>
        {isAdmin && draftCount > 0 && (
          <p className="text-xs text-amber-300">
            {draftCount} {draftCount === 1 ? "draft is" : "drafts are"} only visible to admins until published.
          </p>
        )}
        {rowAction.error && (
          <p role="alert" className="text-sm text-red-300">
            {rowAction.error}
          </p>
        )}
      </div>

      {!loaded ? (
        <div className="relative flex flex-col gap-5 pl-6" aria-busy="true" aria-label="Loading the changelog">
          <div className="absolute bottom-2 left-[9px] top-2 w-px bg-[var(--glass-border)]" aria-hidden />
          {[0, 1, 2].map((i) => (
            <div key={i} className="glass-card flex h-[104px] flex-col gap-3 p-5">
              <Shimmer className="h-4 w-1/3" />
              <Shimmer className="h-5 w-2/3" />
              <Shimmer className="h-3 w-1/2" />
            </div>
          ))}
        </div>
      ) : displayed.length === 0 ? (
        <div className="glass-card flex flex-col items-center gap-3 p-10 text-center">
          <p className="font-medium">{entries.length === 0 ? "Nothing here yet." : "No entries match."}</p>
          <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
            {entries.length === 0 ? (isAdmin ? "Add the first entry to start the team's release notes." : "Release notes will show up here once an admin publishes them.") : "Try a different search, or clear the filters."}
          </p>
          {entries.length > 0 && filterActive ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTypes([]);
                setQuery("");
              }}
            >
              Clear filters
            </Button>
          ) : (
            entries.length === 0 &&
            isAdmin && (
              <Button size="sm" onClick={() => openEditor(null)}>
                <Plus className="h-4 w-4" /> New entry
              </Button>
            )
          )}
        </div>
      ) : (
        <ol className="relative flex flex-col gap-5 pl-6">
          <div className="absolute bottom-2 left-[9px] top-2 w-px bg-[var(--glass-border)]" aria-hidden />
          <AnimatePresence initial={false}>
            {displayed.map((entry) => (
              <motion.li key={entry.id} className="relative list-none" initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                <span
                  className={cn("absolute -left-6 top-6 flex h-[18px] w-[18px] items-center justify-center rounded-full", entry.status === "draft" && "border border-dashed border-[var(--muted-foreground)]")}
                  style={entry.status === "draft" ? undefined : { background: "var(--theme-gradient)" }}
                  aria-hidden
                >
                  <GitCommitVertical className={cn("h-3 w-3", entry.status === "draft" ? "text-[var(--muted-foreground)]" : "text-white")} />
                </span>
                <EntryCard
                  entry={entry}
                  expanded={isExpanded(entry.id)}
                  onToggle={() => setOverrides((o) => ({ ...o, [entry.id]: !isExpanded(entry.id) }))}
                  filterTypes={types}
                  admin={isAdmin}
                  actionsDisabled={!actor || rowAction.busy}
                  onEdit={() => openEditor(entry)}
                  onDelete={() => {
                    deleteAction.clearError();
                    setDeleting(entry);
                    setDeleteOpen(true);
                  }}
                  onTogglePinned={() => actor && void rowAction.run(() => patchEntry(actor, entry.id, { pinned: !entry.pinned }), "Couldn't update the entry.")}
                  onTogglePublished={() => actor && void rowAction.run(() => patchEntry(actor, entry.id, { status: entry.status === "draft" ? "published" : "draft" }), "Couldn't update the entry.")}
                />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}

      {editor && actor && <EntryEditor key={editor.key} open={editorOpen} onOpenChange={setEditorOpen} entryId={editor.entryId} initial={editor.initial} actor={actor} />}

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogTitle className="pr-8">Delete this entry?</DialogTitle>
          <DialogDescription>
            {deleting ? (
              <>
                <strong className="text-[var(--foreground)]">{entryLabel(deleting)}</strong> will be removed for everyone
                {deleting.status === "published" ? " — it's currently published" : ""}. This can&apos;t be undone.
              </>
            ) : null}
          </DialogDescription>
          {deleteAction.error && (
            <p role="alert" className="mt-3 text-sm text-red-300">
              {deleteAction.error}
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleteOpen(false)} disabled={deleteAction.busy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmDelete()} disabled={deleteAction.busy}>
              {deleteAction.busy ? "Deleting…" : "Delete entry"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
