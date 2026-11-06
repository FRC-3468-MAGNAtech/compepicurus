"use client";

import { useMemo, useRef, useState } from "react";
import { ChevronDown, Film } from "lucide-react";
import { FieldError, MATCH_TYPE_OPTIONS, WarningList, selectClass } from "@/components/admin/library/shared";
import { VideoMarker } from "@/components/admin/library/video-marker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import { parseMatchType } from "@/lib/library/ids";
import { emptyRawMatch, libraryMatchToValid, matchLabel, matchWarnings, nextMatchNumber, validateRawMatch, type RawField, type RawMatch } from "@/lib/library/manual-match";
import { upsertManualMatches, type Actor, type LibraryEvent } from "@/lib/library/store";
import type { LibraryMatch } from "@/lib/match-library";
import { cn } from "@/lib/utils";

const COLUMNS: { field: RawField; label: string; width: string; tone?: "red" | "blue" }[] = [
  { field: "matchNumber", label: "#", width: "w-16" },
  { field: "red1", label: "Red 1", width: "w-20", tone: "red" },
  { field: "red2", label: "Red 2", width: "w-20", tone: "red" },
  { field: "blue1", label: "Blue 1", width: "w-20", tone: "blue" },
  { field: "blue2", label: "Blue 2", width: "w-20", tone: "blue" },
  { field: "redScore", label: "Red score", width: "w-20", tone: "red" },
  { field: "blueScore", label: "Blue score", width: "w-20", tone: "blue" },
  { field: "redPenalty", label: "Red pen.", width: "w-16", tone: "red" },
  { field: "bluePenalty", label: "Blue pen.", width: "w-16", tone: "blue" },
  { field: "youtubeUrl", label: "YouTube link", width: "w-56" },
  { field: "start", label: "Start (opt.)", width: "w-24" },
  { field: "end", label: "End (opt.)", width: "w-24" },
];

/**
 * Spreadsheet-like entry for typing a whole event, one match after another.
 * Tab moves left to right through the row; Enter (or **Save and add next**)
 * saves it, bumps the match number, keeps the match type and video link, and
 * puts the cursor back on the first team box. A blank link uses the event's
 * "Default video", so one long stream can serve every match with its own
 * start/end. Validation is the same `validateRawMatch` as everywhere else.
 */
export function FastEntry({ event, eventMatches, actor }: { event: LibraryEvent; eventMatches: LibraryMatch[]; actor: Actor }) {
  const [raw, setRaw] = useState<RawMatch>(() => ({ ...emptyRawMatch(), matchNumber: String(nextMatchNumber(eventMatches, "Qualification")) }));
  const [showErrors, setShowErrors] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [showVideo, setShowVideo] = useState(false);
  const firstTeamRef = useRef<HTMLInputElement>(null);

  const set = (field: RawField, value: string) => setRaw((r) => ({ ...r, [field]: value }));
  const result = useMemo(() => validateRawMatch(raw, { defaultVideoUrl: event.defaultVideoUrl }), [raw, event.defaultVideoUrl]);
  const warnings = useMemo(
    () => (result.match ? matchWarnings(result.match, { event, existingIds: new Set(eventMatches.map((m) => m.id)), siblings: eventMatches.map(libraryMatchToValid) }) : []),
    [result.match, event, eventMatches]
  );

  const submit = async () => {
    setShowErrors(true);
    setMessage(null);
    const match = result.match;
    if (!match) return;
    setBusy(true);
    try {
      const summary = await upsertManualMatches(actor, event, [match], { newPublished: true, newNeedsReview: false });
      if (summary.skipped.length > 0) {
        setMessage({ kind: "error", text: summary.skipped[0].reason });
        return;
      }
      const next = match.matchNumber + 1;
      setMessage({ kind: "ok", text: `Saved ${matchLabel(match)}. Ready for ${MATCH_TYPE_PREFIX[match.matchType]}${next}.` });
      setRaw({ ...emptyRawMatch(), matchType: MATCH_TYPE_PREFIX[match.matchType], matchNumber: String(next), youtubeUrl: raw.youtubeUrl });
      setShowErrors(false);
      firstTeamRef.current?.focus();
    } catch (err) {
      console.error("fast entry save failed:", err);
      setMessage({ kind: "error", text: "Couldn't save that match. Check your connection and try again." });
    } finally {
      setBusy(false);
    }
  };

  const type = parseMatchType(raw.matchType);
  const errorEntries = showErrors ? Object.entries(result.errors) : [];

  return (
    <form
      className="flex flex-col gap-3 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold">Fast entry</h4>
        <p className="text-xs text-[var(--muted-foreground)]">
          Tab between boxes, Enter to save. {event.defaultVideoUrl ? "A blank link uses this event's default video." : "Set a default video for the event to skip the link on every row."}
        </p>
      </div>

      <div className="overflow-x-auto pb-1">
        <div className="flex min-w-max items-end gap-2">
          <div className="w-28 shrink-0">
            <label htmlFor="fe-type" className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
              Type
            </label>
            <select id="fe-type" className={cn(selectClass, "h-9 w-full text-xs")} value={type ? MATCH_TYPE_PREFIX[type] : ""} onChange={(e) => set("matchType", e.target.value)}>
              {MATCH_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {COLUMNS.map((c) => (
            <div key={c.field} className={cn("shrink-0", c.width)}>
              <label htmlFor={`fe-${c.field}`} className={cn("mb-1 block text-[10px] font-medium uppercase tracking-wide", c.tone === "red" ? "text-red-300" : c.tone === "blue" ? "text-blue-300" : "text-[var(--muted-foreground)]")}>
                {c.label}
              </label>
              <Input
                id={`fe-${c.field}`}
                ref={c.field === "red1" ? firstTeamRef : undefined}
                className="h-9 px-2.5 text-xs"
                inputMode={c.field === "youtubeUrl" ? "url" : c.field === "start" || c.field === "end" ? "text" : "numeric"}
                value={raw[c.field]}
                onChange={(e) => set(c.field, e.target.value)}
                aria-invalid={showErrors && !!result.errors[c.field]}
                placeholder={c.field === "youtubeUrl" ? (event.defaultVideoUrl ? "(default video)" : "https://youtu.be/…") : undefined}
              />
            </div>
          ))}
        </div>
      </div>

      {errorEntries.length > 0 && (
        <ul className="flex flex-col gap-0.5">
          {errorEntries.map(([field, text]) => (
            <li key={field}>
              <FieldError className="mt-0">{text}</FieldError>
            </li>
          ))}
        </ul>
      )}
      <WarningList warnings={warnings} />
      {message && (
        <p role={message.kind === "error" ? "alert" : "status"} className={cn("text-xs", message.kind === "ok" ? "text-emerald-300" : "text-red-300")}>
          {message.text}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save and add next"}
        </Button>
        <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setShowVideo((v) => !v)} aria-expanded={showVideo}>
          <Film className="h-3.5 w-3.5" /> {showVideo ? "Hide video" : "Show video to set start/end"}
          <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showVideo && "rotate-180")} />
        </Button>
      </div>

      {showVideo && <VideoMarker url={raw.youtubeUrl.trim() || event.defaultVideoUrl || ""} startText={raw.start} onSetStart={(t) => set("start", t)} onSetEnd={(t) => set("end", t)} />}
    </form>
  );
}
