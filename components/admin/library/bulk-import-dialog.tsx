"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { EventFields, emptyEventForm } from "@/components/admin/library/manual-event-dialog";
import { FieldError, MATCH_TYPE_OPTIONS, selectClass } from "@/components/admin/library/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { downloadTextFile } from "@/lib/download";
import { bulkTemplateCsv, summarizeBulk, validateBulk } from "@/lib/library/bulk";
import { validateEventForm, type EventFormErrors, type EventFormInput } from "@/lib/library/event-form";
import { parseMatchType } from "@/lib/library/ids";
import { createManualEvent, upsertManualMatches, type Actor, type LibraryEvent, type UpsertResult } from "@/lib/library/store";
import { parseYouTubeUrl } from "@/lib/library/youtube-url";
import { useLibraryMatches } from "@/lib/match-library";
import { DEFAULT_SEASON_ID } from "@/lib/seasons";
import { cn } from "@/lib/utils";

const NEW_EVENT = "__new__";
const MAX_PREVIEW_ROWS = 200;

/**
 * Bulk entry for ONE event: pick (or create) the event once, set event-level
 * defaults, paste rows copied from a spreadsheet or upload a CSV, review the
 * validation preview, then import. Every row gets the event's code, so there's
 * no event column to repeat. Imported matches start unpublished with a
 * "Needs review" badge (lib/library/store.ts); importing is idempotent — the
 * match id is the key, so running the same text again updates instead of duplicating.
 */
export function BulkImportDialog({
  open,
  onOpenChange,
  actor,
  events,
  initialEventCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor: Actor;
  /** Manual events only. */
  events: LibraryEvent[];
  initialEventCode: string | null;
}) {
  const [eventChoice, setEventChoice] = useState<string>(initialEventCode ?? events[0]?.eventCode ?? NEW_EVENT);
  const [newEvent, setNewEvent] = useState<EventFormInput>(emptyEventForm());
  const [newSeason, setNewSeason] = useState(DEFAULT_SEASON_ID);
  const [newErrors, setNewErrors] = useState<EventFormErrors>({});
  const [newError, setNewError] = useState<string | null>(null);
  const [createdEvent, setCreatedEvent] = useState<LibraryEvent | null>(null);
  const [creating, setCreating] = useState(false);

  const [defaultType, setDefaultType] = useState("");
  const [defaultUrl, setDefaultUrl] = useState("");
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [result, setResult] = useState<UpsertResult | null>(null);

  const event = eventChoice === NEW_EVENT ? createdEvent : (events.find((e) => e.eventCode === eventChoice) ?? (createdEvent?.eventCode === eventChoice ? createdEvent : null));
  const { matches: existingMatches } = useLibraryMatches(event?.eventCode ?? null, { includeUnpublished: true });

  const defaultUrlError = defaultUrl.trim() !== "" && !parseYouTubeUrl(defaultUrl) ? "That doesn't look like a YouTube link." : null;

  const preview = useMemo(() => {
    if (!event || text.trim() === "") return null;
    return validateBulk({
      text,
      event,
      defaults: { matchType: parseMatchType(defaultType), youtubeUrl: defaultUrl.trim() || event.defaultVideoUrl || "" },
      existing: new Map(existingMatches.map((m) => [m.id, m])),
    });
  }, [text, event, defaultType, defaultUrl, existingMatches]);
  const summary = preview ? summarizeBulk(preview) : null;

  const createEvent = async () => {
    setNewError(null);
    const checked = validateEventForm(newEvent);
    setNewErrors(checked.errors);
    if (!checked.ok) return;
    setCreating(true);
    try {
      const res = await createManualEvent(actor, newEvent, newSeason, events);
      if (!res.ok) {
        setNewErrors(res.fieldErrors ?? {});
        setNewError(res.error);
        return;
      }
      setCreatedEvent(res.event);
      setEventChoice(res.event.eventCode);
    } catch (err) {
      console.error("couldn't create the event:", err);
      setNewError("Couldn't create the event. Check your connection and try again.");
    } finally {
      setCreating(false);
    }
  };

  const loadFile = async (file: File) => {
    setText(await file.text());
    setFileName(file.name);
    setResult(null);
  };

  const runImport = async () => {
    if (!event || !summary || summary.importable.length === 0) return;
    setImporting(true);
    setImportError(null);
    try {
      const res = await upsertManualMatches(
        actor,
        event,
        summary.importable.map((r) => r.match!),
        { newPublished: false, newNeedsReview: true }
      );
      setResult(res);
      setText("");
      setFileName(null);
    } catch (err) {
      console.error("bulk import failed:", err);
      setImportError("Couldn't import. Nothing was partly saved that you can't re-run — importing the same rows again is safe.");
    } finally {
      setImporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !importing && onOpenChange(next)}>
      <DialogContent className="glass-overlay max-h-[92vh] w-[min(96vw,900px)] overflow-y-auto">
        <DialogTitle className="pr-8">Bulk entry for one event</DialogTitle>
        <DialogDescription>Pick the event once — every row below belongs to it. Rows are checked first, and nothing is saved until you press Import.</DialogDescription>

        <div className="mt-5 flex flex-col gap-6">
          {/* 1. The event */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">1. Event</h3>
            <div>
              <Label htmlFor="bulk-event">Target event</Label>
              <select
                id="bulk-event"
                className={cn(selectClass, "w-full sm:w-96")}
                value={eventChoice}
                onChange={(e) => {
                  setEventChoice(e.target.value);
                  setResult(null);
                }}
              >
                {events.map((e) => (
                  <option key={e.eventCode} value={e.eventCode}>
                    {e.eventName} ({e.eventCode})
                  </option>
                ))}
                {createdEvent && !events.some((e) => e.eventCode === createdEvent.eventCode) && (
                  <option value={createdEvent.eventCode}>
                    {createdEvent.eventName} ({createdEvent.eventCode})
                  </option>
                )}
                <option value={NEW_EVENT}>＋ Create new event…</option>
              </select>
            </div>
            {eventChoice === NEW_EVENT && (
              <div className="flex flex-col gap-4 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-4">
                <EventFields value={newEvent} onChange={setNewEvent} errors={newErrors} seasonId={newSeason} onSeasonChange={setNewSeason} showCode />
                {newError && (
                  <p role="alert" className="text-sm text-red-300">
                    {newError}
                  </p>
                )}
                <div>
                  <Button type="button" onClick={() => void createEvent()} disabled={creating}>
                    {creating ? "Creating…" : "Create event"}
                  </Button>
                </div>
              </div>
            )}
            {event && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Importing into <span className="font-medium text-[var(--foreground)]">{event.eventName}</span> (<span className="font-mono">{event.eventCode}</span>) — {existingMatches.length} match{existingMatches.length === 1 ? "" : "es"} already in it.
              </p>
            )}
          </section>

          {/* 2. Defaults */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">2. Event defaults (a row can override them)</h3>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="bulk-default-url">Default YouTube link</Label>
                <Input id="bulk-default-url" type="url" inputMode="url" value={defaultUrl} onChange={(e) => setDefaultUrl(e.target.value)} placeholder={event?.defaultVideoUrl ?? "https://youtu.be/…"} aria-invalid={!!defaultUrlError} />
                <FieldError>{defaultUrlError}</FieldError>
              </div>
              <div>
                <Label htmlFor="bulk-default-type">Default match type</Label>
                <select id="bulk-default-type" className={cn(selectClass, "w-full")} value={defaultType} onChange={(e) => setDefaultType(e.target.value)}>
                  <option value="">None — every row says P, Q, or F</option>
                  {MATCH_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">A blank penalty-points cell counts as 0.</p>
          </section>

          {/* 3. The rows */}
          <section className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold">3. Rows</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInput}
                type="file"
                accept=".csv,.tsv,.txt,text/csv,text/plain"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFile(file);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="glass" size="sm" className="gap-2" onClick={() => fileInput.current?.click()}>
                <FileUp className="h-3.5 w-3.5" /> Upload CSV
              </Button>
              <Button type="button" variant="ghost" size="sm" className="gap-2" onClick={() => downloadTextFile("library-matches-template.csv", bulkTemplateCsv(), "text/csv")}>
                <Download className="h-3.5 w-3.5" /> Download template
              </Button>
              {fileName && <span className="text-xs text-[var(--muted-foreground)]">Loaded {fileName}</span>}
            </div>
            <div>
              <Label htmlFor="bulk-text">…or paste rows copied from Google Sheets or Excel</Label>
              <Textarea
                id="bulk-text"
                rows={7}
                className="font-mono text-xs"
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setResult(null);
                }}
                placeholder={"matchType\tmatchNumber\tred1\tred2\tblue1\tblue2\tredScore\tblueScore\tredPenalty\tbluePenalty\tyoutubeUrl\tstartSec\tendSec\tnotes"}
                spellCheck={false}
              />
              <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">With or without the header row. Columns: matchType, matchNumber, red1, red2, blue1, blue2, redScore, blueScore, redPenalty, bluePenalty, youtubeUrl, startSec, endSec, notes. Times can be 90, 1:30, or 1:02:30; startSec and endSec may be blank (blank start = from the beginning, blank end = until the video ends).</p>
            </div>
          </section>

          {/* 4. Preview */}
          {preview && (
            <section className="flex flex-col gap-3" aria-live="polite">
              <h3 className="text-sm font-semibold">4. Check before importing</h3>
              {preview.columnErrors.length > 0 ? (
                <ul className="rounded-2xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                  {preview.columnErrors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              ) : (
                summary && (
                  <>
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="success">{summary.creates} new</Badge>
                      {summary.updates > 0 && <Badge variant="warning">{summary.updates} will update existing matches</Badge>}
                      {summary.errors > 0 && <Badge variant="danger">{summary.errors} with errors (skipped)</Badge>}
                      {summary.superseded > 0 && <Badge variant="outline">{summary.superseded} duplicate row{summary.superseded === 1 ? "" : "s"} replaced by a later one</Badge>}
                    </div>
                    <div className="max-h-72 overflow-auto rounded-2xl border border-[var(--glass-border)]">
                      <table className="w-full border-collapse text-left text-xs">
                        <thead className="sticky top-0 bg-[#1b1b26] text-[10px] uppercase tracking-wide text-[var(--muted-foreground)]">
                          <tr>
                            <th className="px-3 py-2">Row</th>
                            <th className="px-3 py-2">Match</th>
                            <th className="px-3 py-2">Result</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--glass-border)]">
                          {preview.rows.slice(0, MAX_PREVIEW_ROWS).map((row) => (
                            <tr key={row.rowNumber} className="align-top">
                              <td className="px-3 py-2 font-mono">{row.rowNumber}</td>
                              <td className="px-3 py-2 font-mono">{row.id ?? `${row.raw.matchType || "?"}${row.raw.matchNumber || "?"}`}</td>
                              <td className="px-3 py-2">
                                {row.errors.length > 0 ? (
                                  <ul className="flex flex-col gap-0.5 text-red-300">
                                    {row.errors.map((e) => (
                                      <li key={e}>✕ {e}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className={row.superseded ? "text-[var(--muted-foreground)]" : row.action === "update" ? "text-amber-300" : "text-emerald-300"}>
                                    {row.superseded ? "Skipped" : row.action === "update" ? "Will update" : "New"}
                                  </span>
                                )}
                                {row.warnings.map((w) => (
                                  <div key={w} className="text-amber-200">
                                    ⚠ {w}
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {preview.rows.length > MAX_PREVIEW_ROWS && <p className="px-3 py-2 text-xs text-[var(--muted-foreground)]">Showing the first {MAX_PREVIEW_ROWS} of {preview.rows.length} rows.</p>}
                    </div>
                  </>
                )
              )}
            </section>
          )}

          {result && (
            <div role="status" className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
              Imported {result.created} new and updated {result.updated} match{result.created + result.updated === 1 ? "" : "es"}. They start <strong>unpublished</strong> with a Needs review badge — review them in the table, then Publish.
              {result.skipped.length > 0 && <span className="mt-1 block text-amber-200">Skipped {result.skipped.length}: {result.skipped.map((s) => s.id).join(", ")} (imported API matches are never overwritten).</span>}
            </div>
          )}
          {importError && (
            <p role="alert" className="text-sm text-red-300">
              {importError}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={importing}>
              {result ? "Done" : "Cancel"}
            </Button>
            <Button type="button" onClick={() => void runImport()} disabled={importing || !summary || summary.importable.length === 0 || !!defaultUrlError}>
              {importing ? "Importing…" : summary && summary.importable.length > 0 ? `Import ${summary.importable.length} match${summary.importable.length === 1 ? "" : "es"}` : "Import"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
