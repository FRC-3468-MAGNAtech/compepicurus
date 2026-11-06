"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { FieldError, MATCH_TYPE_OPTIONS, WarningList, selectClass } from "@/components/admin/library/shared";
import { VideoMarker } from "@/components/admin/library/video-marker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { parseMatchType } from "@/lib/library/ids";
import { emptyRawMatch, libraryMatchToValid, manualMatchId, matchToRaw, matchWarnings, nextMatchNumber, validateRawMatch, type RawField, type RawMatch } from "@/lib/library/manual-match";
import { countCompletedSessionsForMatch, upsertManualMatches, type Actor, type LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";
import { cn } from "@/lib/utils";

export type MatchDialogMode = { kind: "new" } | { kind: "edit"; match: LibraryMatch } | { kind: "duplicate"; match: LibraryMatch };

/**
 * The single-match form for a manual event: type and number, the four teams,
 * both scores and penalty points, a YouTube link with start/end times and the
 * preview helpers, and notes. Validation is `validateRawMatch` (shared with
 * fast entry and bulk import); sanity warnings never block saving. Mount with a
 * fresh `key` per open.
 */
export function ManualMatchDialog({
  open,
  onOpenChange,
  event,
  eventMatches,
  mode,
  actor,
  onOpenRescore,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: LibraryEvent;
  /** Every match already in this event (for numbering and sanity warnings). */
  eventMatches: LibraryMatch[];
  mode: MatchDialogMode;
  actor: Actor;
  /** Jumps to the Admin Panel's Rescore tab. */
  onOpenRescore: () => void;
}) {
  const editing = mode.kind === "edit";
  const [raw, setRaw] = useState<RawMatch>(() => {
    if (mode.kind === "edit") return matchToRaw(mode.match);
    if (mode.kind === "duplicate") {
      const base = matchToRaw(mode.match);
      return { ...base, matchNumber: String(nextMatchNumber(eventMatches, mode.match.matchType)) };
    }
    return { ...emptyRawMatch(), matchNumber: String(nextMatchNumber(eventMatches, "Qualification")) };
  });
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sessionCount, setSessionCount] = useState<number | null>(null);

  const set = (field: RawField, value: string) => setRaw((r) => ({ ...r, [field]: value }));

  const result = useMemo(() => validateRawMatch(raw, { defaultVideoUrl: event.defaultVideoUrl }), [raw, event.defaultVideoUrl]);
  const errors = showErrors ? result.errors : {};

  const warnings = useMemo(() => {
    if (!result.match) return [];
    return matchWarnings(result.match, {
      event,
      existingIds: new Set(eventMatches.map((m) => m.id)),
      siblings: eventMatches.map(libraryMatchToValid),
    });
    // In edit mode the match being edited is its own "existing" id, which isn't worth a warning.
  }, [result.match, event, eventMatches]).filter((w) => !(editing && w.includes("already exists")));

  // Editing a match that completed practice sessions already used: say how many, and point at Rescore.
  const editingId = mode.kind === "edit" ? mode.match.id : null;
  useEffect(() => {
    if (!editingId) return;
    let cancelled = false;
    countCompletedSessionsForMatch(actor.teamId, editingId)
      .then((n) => !cancelled && setSessionCount(n))
      .catch(() => !cancelled && setSessionCount(null));
    return () => {
      cancelled = true;
    };
  }, [editingId, actor.teamId]);

  const save = async (addNext: boolean) => {
    setShowErrors(true);
    setSaveError(null);
    if (!result.match) return;
    setBusy(true);
    try {
      const summary = await upsertManualMatches(actor, event, [result.match], { newPublished: true, newNeedsReview: false });
      if (summary.skipped.length > 0) {
        setSaveError(summary.skipped[0].reason);
        return;
      }
      if (addNext) {
        // Keep the type and video link; the next match has a new number and fresh teams, scores, and times.
        const type = result.match.matchType;
        setRaw({ ...emptyRawMatch(), matchType: MATCH_TYPE_PREFIX[type], matchNumber: String(result.match.matchNumber + 1), youtubeUrl: raw.youtubeUrl });
        setShowErrors(false);
      } else {
        onOpenChange(false);
      }
    } catch (err) {
      console.error("couldn't save the manual match:", err);
      setSaveError("Couldn't save the match. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  const type = parseMatchType(raw.matchType);
  const idPreview = result.match ? manualMatchId(event, result.match) : null;
  const title = mode.kind === "edit" ? "Edit match" : mode.kind === "duplicate" ? "Duplicate match" : "Add match";

  const teamField = (field: RawField, label: string, tone: "red" | "blue") => (
    <div>
      <Label htmlFor={`mm-${field}`} className={tone === "red" ? "text-red-300" : "text-blue-300"}>
        {label}
      </Label>
      <Input id={`mm-${field}`} inputMode="numeric" value={raw[field]} onChange={(e) => set(field, e.target.value)} aria-invalid={!!errors[field]} placeholder="Team #" />
      <FieldError>{errors[field]}</FieldError>
    </div>
  );
  const numberField = (field: RawField, label: string, tone: "red" | "blue") => (
    <div>
      <Label htmlFor={`mm-${field}`} className={tone === "red" ? "text-red-300" : "text-blue-300"}>
        {label}
      </Label>
      <Input id={`mm-${field}`} inputMode="numeric" value={raw[field]} onChange={(e) => set(field, e.target.value)} aria-invalid={!!errors[field]} placeholder={field.endsWith("Penalty") ? "0" : "Score"} />
      <FieldError>{errors[field]}</FieldError>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="glass-overlay max-h-[92vh] w-[min(95vw,760px)] overflow-y-auto">
        <DialogTitle className="pr-8">{title}</DialogTitle>
        <DialogDescription>
          {event.eventName} <span className="font-mono text-xs">({event.eventCode})</span>
          {idPreview && <span className="ml-2 font-mono text-xs">→ {idPreview}</span>}
        </DialogDescription>

        {editing && sessionCount !== null && sessionCount > 0 && (
          <div className="mt-4 flex flex-wrap items-start gap-2 rounded-2xl border border-amber-400/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <p className="min-w-0 flex-1">
              {sessionCount} completed practice session{sessionCount === 1 ? "" : "s"} already used this match. Changing its scores changes the official numbers their accuracy was measured against — after saving, run{" "}
              <button type="button" className="font-semibold underline underline-offset-2" onClick={onOpenRescore}>
                the Rescore tool
              </button>{" "}
              to recalculate them.
            </p>
          </div>
        )}

        <form
          className="mt-5 flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save(false);
          }}
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="col-span-2">
              <Label htmlFor="mm-type">Match type</Label>
              <select id="mm-type" className={cn(selectClass, "w-full")} value={type ? MATCH_TYPE_PREFIX[type] : ""} onChange={(e) => set("matchType", e.target.value)} disabled={editing}>
                {MATCH_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <FieldError>{errors.matchType}</FieldError>
            </div>
            <div className="col-span-2">
              <Label htmlFor="mm-number">Match number</Label>
              <Input id="mm-number" inputMode="numeric" value={raw.matchNumber} onChange={(e) => set("matchNumber", e.target.value)} aria-invalid={!!errors.matchNumber} disabled={editing} />
              <FieldError>{errors.matchNumber}</FieldError>
            </div>
            {editing && <p className="col-span-full text-xs text-[var(--muted-foreground)]">To renumber a match, duplicate it and delete the original.</p>}
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-red-400/20 bg-red-500/5 p-3 sm:grid-cols-4">
            {teamField("red1", "Red team 1", "red")}
            {teamField("red2", "Red team 2", "red")}
            {numberField("redScore", "Red score", "red")}
            {numberField("redPenalty", "Red penalty pts", "red")}
          </div>
          <div className="grid grid-cols-2 gap-3 rounded-2xl border border-blue-400/20 bg-blue-500/5 p-3 sm:grid-cols-4">
            {teamField("blue1", "Blue team 1", "blue")}
            {teamField("blue2", "Blue team 2", "blue")}
            {numberField("blueScore", "Blue score", "blue")}
            {numberField("bluePenalty", "Blue penalty pts", "blue")}
          </div>
          <p className="-mt-2 text-xs text-[var(--muted-foreground)]">Penalty points are the points awarded to that alliance from the opponent&apos;s penalties — already included in its score.</p>

          <div className="flex flex-col gap-3">
            <div>
              <Label htmlFor="mm-url">YouTube link</Label>
              <Input id="mm-url" type="url" inputMode="url" value={raw.youtubeUrl} onChange={(e) => set("youtubeUrl", e.target.value)} placeholder={event.defaultVideoUrl ? "Leave blank to use the event's default video" : "https://youtu.be/…"} aria-invalid={!!errors.youtubeUrl} />
              <FieldError>{errors.youtubeUrl}</FieldError>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="mm-start">Start time (optional)</Label>
                <Input id="mm-start" value={raw.start} onChange={(e) => set("start", e.target.value)} placeholder="blank = from the start" aria-invalid={!!errors.start} />
                <FieldError>{errors.start}</FieldError>
              </div>
              <div>
                <Label htmlFor="mm-end">End time (optional)</Label>
                <Input id="mm-end" value={raw.end} onChange={(e) => set("end", e.target.value)} placeholder="blank = until the video ends" aria-invalid={!!errors.end} />
                <FieldError>{errors.end}</FieldError>
              </div>
            </div>
            <VideoMarker url={raw.youtubeUrl.trim() || event.defaultVideoUrl || ""} startText={raw.start} onSetStart={(t) => set("start", t)} onSetEnd={(t) => set("end", t)} />
          </div>

          <div>
            <Label htmlFor="mm-notes">Notes (optional)</Label>
            <Textarea id="mm-notes" rows={2} value={raw.notes} onChange={(e) => set("notes", e.target.value)} aria-invalid={!!errors.notes} />
            <FieldError>{errors.notes}</FieldError>
          </div>

          <WarningList warnings={warnings} />
          {saveError && (
            <p role="alert" className="text-sm text-red-300">
              {saveError}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            {!editing && (
              <Button type="button" variant="glass" onClick={() => void save(true)} disabled={busy}>
                Save and add next
              </Button>
            )}
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
