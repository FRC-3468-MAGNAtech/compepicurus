"use client";

import { useMemo, useState } from "react";
import { CalendarPlus, Copy, FileSpreadsheet, ListPlus, Pencil, Plus, Rows3, Search, Trash2, VideoOff } from "lucide-react";
import { BulkImportDialog } from "@/components/admin/library/bulk-import-dialog";
import { FastEntry } from "@/components/admin/library/fast-entry";
import { ManualEventDialog } from "@/components/admin/library/manual-event-dialog";
import { ManualMatchDialog, type MatchDialogMode } from "@/components/admin/library/manual-match-dialog";
import { FieldError, selectClass } from "@/components/admin/library/shared";
import { ConfirmDeleteDialog } from "@/components/credits/credit-dialogs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { useAuth } from "@/lib/auth";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { DIFFICULTY_CLASSNAMES, DIFFICULTY_LABELS } from "@/lib/difficulty";
import { formatTime } from "@/lib/library/time";
import { parseYouTubeUrl } from "@/lib/library/youtube-url";
import {
  deleteManualEvent,
  deleteManualMatches,
  setMatchesPublished,
  setMatchesVideoLink,
  useLibraryEvents,
  type Actor,
  type LibraryEvent,
} from "@/lib/library/store";
import { useLibraryMatches, type LibraryMatch } from "@/lib/match-library";
import { getSeason } from "@/lib/seasons";
import { cn } from "@/lib/utils";

type StatusFilter = "all" | "published" | "review" | "unpublished";

type MatchStatus = "published" | "review" | "unpublished";
const statusOf = (m: LibraryMatch): MatchStatus => (m.published === false ? (m.needsReview ? "review" : "unpublished") : "published");

const STATUS_FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "published", label: "Published" },
  { value: "review", label: "Needs review" },
  { value: "unpublished", label: "Unpublished" },
];

/** The "Origin" column's badge — manual matches are visibly marked, imported ones too. */
/** "1:10–3:40", "1:10–end", "start–3:40", or "whole video" — a blank time reads as the beginning / the video's end. */
export function windowLabel(video: { startSec?: number | null; endSec?: number | null }): string {
  const start = typeof video.startSec === "number" ? formatTime(video.startSec) : null;
  const end = typeof video.endSec === "number" ? formatTime(video.endSec) : null;
  if (start === null && end === null) return "whole video";
  return `${start ?? "start"}–${end ?? "end"}`;
}

export function OriginBadge({ origin }: { origin: "api" | "manual" }) {
  return (
    <Badge variant={origin === "manual" ? "accent" : "outline"} className="text-[10px]">
      {origin === "manual" ? "Manual" : "API"}
    </Badge>
  );
}

function StatusBadge({ status }: { status: MatchStatus }) {
  if (status === "published") return <Badge variant="success">Published</Badge>;
  if (status === "review") return <Badge variant="warning">Needs review</Badge>;
  return <Badge variant="outline">Unpublished</Badge>;
}

/**
 * Admin Panel > Match Library > Manual events (P15): create events for matches
 * whose scores aren't in the FIRST API, enter matches one at a time, in fast
 * rows, or in bulk (CSV / spreadsheet paste), then review and publish them.
 * Manual matches live in the same `libraryMatches` collection and work everywhere
 * an imported match does; they are never overwritten by an API import.
 */
export function ManualLibraryPanel({ onOpenRescore }: { onOpenRescore: () => void }) {
  const { user, profile } = useAuth();
  const actor: Actor | null = user && profile ? { teamId: profile.teamId, uid: user.uid, name: profile.name } : null;

  const { events, loaded: eventsLoaded } = useLibraryEvents();
  const manualEvents = useMemo(() => events.filter((e) => e.origin === "manual"), [events]);
  const [chosenCode, setChosenCode] = useState<string | null>(null);
  const event: LibraryEvent | null = manualEvents.find((e) => e.eventCode === chosenCode) ?? manualEvents[0] ?? null;

  const { matches, loaded: matchesLoaded } = useLibraryMatches(event?.eventCode ?? null, { includeUnpublished: true });

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFast, setShowFast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // Dialogs. `counter` gives each open a fresh key so forms start from the right values.
  const [counter, setCounter] = useState(0);
  const [eventDialog, setEventDialog] = useState<{ key: number; edit: boolean } | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [matchDialog, setMatchDialog] = useState<{ key: number; mode: MatchDialogMode } | null>(null);
  const [matchDialogOpen, setMatchDialogOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkKey, setBulkKey] = useState(0);
  const [confirm, setConfirm] = useState<{ kind: "matches"; ids: string[]; label: string } | { kind: "event" } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [videoDialogOpen, setVideoDialogOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState("");
  const [videoError, setVideoError] = useState<string | null>(null);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return matches.filter((m) => {
      if (statusFilter !== "all" && statusOf(m) !== statusFilter) return false;
      if (q === "") return true;
      const label = `${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`.toLowerCase();
      const teams = [...m.alliances.red.teams, ...m.alliances.blue.teams].join(" ");
      return label.includes(q) || teams.includes(q) || (m.notes ?? "").toLowerCase().includes(q);
    });
  }, [matches, query, statusFilter]);

  const matchIds = useMemo(() => new Set(matches.map((m) => m.id)), [matches]);
  const selectedIds = useMemo(() => [...selected].filter((id) => matchIds.has(id)), [selected, matchIds]);
  const selectedMatches = matches.filter((m) => selected.has(m.id));
  const reviewMatches = matches.filter((m) => statusOf(m) === "review");
  const missingVideo = matches.filter((m) => !m.video).length;
  const allVisibleSelected = visible.length > 0 && visible.every((m) => selected.has(m.id));

  const openMatchDialog = (mode: MatchDialogMode) => {
    setCounter((c) => c + 1);
    setMatchDialog({ key: counter + 1, mode });
    setMatchDialogOpen(true);
  };
  const openEventDialog = (edit: boolean) => {
    setCounter((c) => c + 1);
    setEventDialog({ key: counter + 1, edit });
    setEventDialogOpen(true);
  };
  const toggle = (id: string) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const run = async (work: () => Promise<string | void>) => {
    setBusy(true);
    setMessage(null);
    try {
      const text = await work();
      if (text) setMessage({ kind: "ok", text });
    } catch (err) {
      console.error("library action failed:", err);
      setMessage({ kind: "error", text: err instanceof Error && err.message.startsWith("Delete this") ? err.message : "That didn't save. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const publish = (ids: string[], published: boolean) =>
    actor &&
    run(async () => {
      await setMatchesPublished(actor, ids, published);
      setSelected(new Set());
      return `${published ? "Published" : "Unpublished"} ${ids.length} match${ids.length === 1 ? "" : "es"}.`;
    });

  const applyVideo = () => {
    const parsed = parseYouTubeUrl(videoUrl);
    if (!parsed) {
      setVideoError("That doesn't look like a YouTube link.");
      return;
    }
    if (!actor) return;
    setVideoDialogOpen(false);
    void run(async () => {
      await setMatchesVideoLink(actor, selectedMatches, parsed.videoId);
      setSelected(new Set());
      return `Set the video link on ${selectedMatches.length} match${selectedMatches.length === 1 ? "" : "es"}.`;
    });
  };

  const confirmed = () => {
    if (!actor || !confirm) return;
    if (confirm.kind === "matches") {
      const ids = confirm.ids;
      void run(async () => {
        await deleteManualMatches(actor, ids);
        setSelected(new Set());
        return `Deleted ${ids.length} match${ids.length === 1 ? "" : "es"}.`;
      });
    } else if (event) {
      void run(async () => {
        await deleteManualEvent(actor, event);
        setChosenCode(null);
        return `Deleted ${event.eventName}.`;
      });
    }
  };

  if (!eventsLoaded) return <div className="glass-card h-24 animate-pulse" />;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[220px] flex-1">
          <Label htmlFor="manual-event">Manual event</Label>
          <select id="manual-event" className={cn(selectClass, "w-full")} value={event?.eventCode ?? ""} onChange={(e) => { setChosenCode(e.target.value); setSelected(new Set()); }} disabled={manualEvents.length === 0}>
            {manualEvents.length === 0 && <option value="">No manual events yet</option>}
            {manualEvents.map((e) => (
              <option key={e.eventCode} value={e.eventCode}>
                {e.eventName} ({e.eventCode})
              </option>
            ))}
          </select>
        </div>
        <Button className="gap-2" onClick={() => openEventDialog(false)} disabled={!actor}>
          <CalendarPlus className="h-4 w-4" /> Add manual event
        </Button>
        {event && (
          <>
            <Button variant="glass" className="gap-2" onClick={() => openEventDialog(true)}>
              <Pencil className="h-4 w-4" /> Edit event
            </Button>
            <Button
              variant="ghost"
              className="gap-2 hover:text-red-300"
              disabled={matches.length > 0}
              title={matches.length > 0 ? "Delete this event's matches first." : undefined}
              onClick={() => {
                setConfirm({ kind: "event" });
                setConfirmOpen(true);
              }}
            >
              <Trash2 className="h-4 w-4" /> Delete event
            </Button>
          </>
        )}
      </div>

      {!event ? (
        <p className="rounded-2xl border border-dashed border-[var(--glass-border)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
          For events whose scores aren&apos;t in the FIRST API. Add a manual event, then enter its matches by hand or in bulk.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--muted-foreground)]">
            <span>{getSeason(event.seasonId).name}</span>
            {event.date && <span>{event.date}</span>}
            {event.sourceUrl && (
              <a href={event.sourceUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:text-[var(--foreground)]">
                Source of the scores
              </a>
            )}
            <span>{event.defaultVideoUrl ? "Default video set" : "No default video"}</span>
            {missingVideo > 0 && <Badge variant="warning">{missingVideo} missing video</Badge>}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button className="gap-2" onClick={() => openMatchDialog({ kind: "new" })} disabled={!actor}>
              <Plus className="h-4 w-4" /> Add match
            </Button>
            <Button variant="glass" className="gap-2" onClick={() => setShowFast((v) => !v)} aria-pressed={showFast}>
              <Rows3 className="h-4 w-4" /> {showFast ? "Hide fast entry" : "Fast entry"}
            </Button>
            <Button
              variant="glass"
              className="gap-2"
              onClick={() => {
                setBulkKey((k) => k + 1);
                setBulkOpen(true);
              }}
              disabled={!actor}
            >
              <FileSpreadsheet className="h-4 w-4" /> Bulk import
            </Button>
          </div>

          {showFast && actor && <FastEntry event={event} eventMatches={matches} actor={actor} />}

          {reviewMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
              <span className="min-w-0 flex-1">
                {reviewMatches.length} imported match{reviewMatches.length === 1 ? "" : "es"} need{reviewMatches.length === 1 ? "s" : ""} review. They&apos;re hidden from scouts until published.
              </span>
              <Button size="sm" disabled={busy} onClick={() => void publish(reviewMatches.map((m) => m.id), true)}>
                Publish all ({reviewMatches.length})
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]" aria-hidden />
              <Input aria-label="Search matches" className="h-10 pl-10" placeholder="Search match or team" value={query} onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div role="group" aria-label="Filter by status" className="flex flex-wrap gap-1.5">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  aria-pressed={statusFilter === f.value}
                  onClick={() => setStatusFilter(f.value)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", statusFilter === f.value ? "border-transparent bg-white/15 text-[var(--foreground)]" : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:bg-white/6")}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          {selectedIds.length > 0 && (
            <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/6 px-4 py-2.5">
              <span className="mr-1 text-sm font-medium">{selectedIds.length} selected</span>
              <Button size="sm" variant="glass" disabled={busy} onClick={() => { setVideoUrl(""); setVideoError(null); setVideoDialogOpen(true); }}>
                Set video link
              </Button>
              <Button size="sm" variant="glass" disabled={busy} onClick={() => void publish(selectedIds, true)}>
                Publish
              </Button>
              <Button size="sm" variant="glass" disabled={busy} onClick={() => void publish(selectedIds, false)}>
                Unpublish
              </Button>
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() => {
                  setConfirm({ kind: "matches", ids: selectedIds, label: `${selectedIds.length} match${selectedIds.length === 1 ? "" : "es"}` });
                  setConfirmOpen(true);
                }}
              >
                Delete
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </div>
          )}

          {message && (
            <p role={message.kind === "error" ? "alert" : "status"} className={cn("text-sm", message.kind === "ok" ? "text-emerald-300" : "text-red-300")}>
              {message.text}
            </p>
          )}

          {!matchesLoaded ? (
            <div className="glass-card h-24 animate-pulse" />
          ) : matches.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No matches in this event yet — add one, use fast entry, or bulk import.</p>
          ) : visible.length === 0 ? (
            <p className="text-sm text-[var(--muted-foreground)]">No matches fit that search or filter.</p>
          ) : (
            <Table>
              <THead>
                <TR>
                  <TH className="w-10">
                    <Checkbox
                      checked={allVisibleSelected}
                      aria-label="Select all shown matches"
                      onCheckedChange={(v) =>
                        setSelected((cur) => {
                          const next = new Set(cur);
                          for (const m of visible) {
                            if (v) next.add(m.id);
                            else next.delete(m.id);
                          }
                          return next;
                        })
                      }
                    />
                  </TH>
                  <TH>Match</TH>
                  <TH>Origin</TH>
                  <TH>Red</TH>
                  <TH>Blue</TH>
                  <TH>Video</TH>
                  <TH>Status</TH>
                  <TH>&nbsp;</TH>
                </TR>
              </THead>
              <TBody>
                {visible.map((m) => (
                  <TR key={m.id}>
                    <TD>
                      <Checkbox checked={selected.has(m.id)} aria-label={`Select ${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`} onCheckedChange={() => toggle(m.id)} />
                    </TD>
                    <TD className="font-mono font-medium">
                      {MATCH_TYPE_PREFIX[m.matchType]}
                      {m.matchNumber}
                    </TD>
                    <TD>
                      <OriginBadge origin="manual" />
                    </TD>
                    {(["red", "blue"] as const).map((side) => {
                      const a = m.alliances[side];
                      return (
                        <TD key={side}>
                          <div className={cn("flex flex-col gap-1", side === "red" ? "text-red-300" : "text-blue-300")}>
                            <span className="font-mono text-xs">{a.teams.join(" & ")}</span>
                            <span className="flex items-center gap-1.5">
                              {a.score}
                              {a.penaltyPoints > 0 && <span className="text-[10px] text-[var(--muted-foreground)]">({a.penaltyPoints} pen.)</span>}
                              <Badge className={DIFFICULTY_CLASSNAMES[a.difficulty]}>{DIFFICULTY_LABELS[a.difficulty]}</Badge>
                            </span>
                          </div>
                        </TD>
                      );
                    })}
                    <TD>
                      {m.video ? (
                        <span className="font-mono text-xs" title="Blank start = from the beginning; blank end = until the video ends">
                          {windowLabel(m.video)}
                        </span>
                      ) : (
                        <span title="Missing video" className="inline-flex items-center gap-1 text-xs text-amber-300">
                          <VideoOff className="h-4 w-4" /> None
                        </span>
                      )}
                    </TD>
                    <TD>
                      <StatusBadge status={statusOf(m)} />
                    </TD>
                    <TD>
                      <div className="flex items-center gap-0.5">
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Edit ${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`} onClick={() => openMatchDialog({ kind: "edit", match: m })}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="h-8 w-8" aria-label={`Duplicate ${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`} onClick={() => openMatchDialog({ kind: "duplicate", match: m })}>
                          <Copy className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 hover:text-red-300"
                          aria-label={`Delete ${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}`}
                          onClick={() => {
                            setConfirm({ kind: "matches", ids: [m.id], label: `${MATCH_TYPE_PREFIX[m.matchType]}${m.matchNumber}` });
                            setConfirmOpen(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          )}
        </>
      )}

      {eventDialog && actor && (
        <ManualEventDialog
          key={eventDialog.key}
          open={eventDialogOpen}
          onOpenChange={setEventDialogOpen}
          actor={actor}
          existingEvents={events}
          event={eventDialog.edit ? (event ?? undefined) : undefined}
          eventMatchIds={matches.map((m) => m.id)}
          onSaved={(code) => setChosenCode(code)}
        />
      )}
      {matchDialog && actor && event && <ManualMatchDialog key={matchDialog.key} open={matchDialogOpen} onOpenChange={setMatchDialogOpen} event={event} eventMatches={matches} mode={matchDialog.mode} actor={actor} onOpenRescore={onOpenRescore} />}
      {actor && bulkOpen && <BulkImportDialog key={bulkKey} open={bulkOpen} onOpenChange={setBulkOpen} actor={actor} events={manualEvents} initialEventCode={event?.eventCode ?? null} />}

      <ConfirmDeleteDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title={confirm?.kind === "event" ? `Delete “${event?.eventName ?? "this event"}”?` : `Delete ${confirm?.kind === "matches" ? confirm.label : "matches"}?`}
        detail={
          confirm?.kind === "event"
            ? "This removes the empty event. Its code can then be reused."
            : "This removes the match from the library for everyone. Practice sessions already scored against it keep their results but can no longer be rescored. This can't be undone."
        }
        confirmLabel={confirm?.kind === "event" ? "Delete event" : "Delete"}
        onConfirm={confirmed}
      />

      <Dialog open={videoDialogOpen} onOpenChange={setVideoDialogOpen}>
        <DialogContent className="glass-overlay">
          <DialogTitle className="pr-8">Set the video link</DialogTitle>
          <DialogDescription>
            For {selectedMatches.length} selected match{selectedMatches.length === 1 ? "" : "es"}. Each keeps its own start and end times; a match with none plays from the beginning to the end of the video.
          </DialogDescription>
          <form
            className="mt-4 flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              applyVideo();
            }}
          >
            <div>
              <Label htmlFor="bulk-video">YouTube link</Label>
              <Input id="bulk-video" autoFocus type="url" inputMode="url" value={videoUrl} onChange={(e) => setVideoUrl(e.target.value)} placeholder="https://youtu.be/…" aria-invalid={!!videoError} />
              <FieldError>{videoError}</FieldError>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setVideoDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">
                <ListPlus className="h-4 w-4" /> Apply
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
