"use client";

import { useState } from "react";
import { FieldError, selectClass } from "@/components/admin/library/shared";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Label } from "@/components/ui/input";
import { MAX_EVENT_NAME, validateEventForm, type EventFormErrors, type EventFormInput } from "@/lib/library/event-form";
import { MANUAL_CODE_PREFIX } from "@/lib/library/ids";
import { createManualEvent, updateManualEvent, type Actor, type LibraryEvent } from "@/lib/library/store";
import { DEFAULT_SEASON_ID, getEnabledSeasons } from "@/lib/seasons";
import { cn } from "@/lib/utils";

const SEASONS = getEnabledSeasons();

/** The "event form" fields, shared by the create dialog and the inline create inside Bulk import. */
export function EventFields({
  value,
  onChange,
  errors,
  seasonId,
  onSeasonChange,
  showCode,
  showSeason = true,
}: {
  value: EventFormInput;
  onChange: (next: EventFormInput) => void;
  errors: EventFormErrors;
  seasonId: string;
  onSeasonChange: (id: string) => void;
  showCode: boolean;
  showSeason?: boolean;
}) {
  const set = (key: keyof EventFormInput, v: string) => onChange({ ...value, [key]: v });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <Label htmlFor="ev-name">Event name</Label>
        <Input id="ev-name" value={value.name} maxLength={MAX_EVENT_NAME} onChange={(e) => set("name", e.target.value)} placeholder="Practice scrimmage at the shop" aria-invalid={!!errors.name} />
        <FieldError>{errors.name}</FieldError>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {showSeason && (
          <div>
            <Label htmlFor="ev-season">Season</Label>
            <select id="ev-season" className={cn(selectClass, "w-full")} value={seasonId} onChange={(e) => onSeasonChange(e.target.value)}>
              {SEASONS.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {showCode && (
          <div>
            <Label htmlFor="ev-code">Event code (optional)</Label>
            <Input id="ev-code" value={value.code} onChange={(e) => set("code", e.target.value)} placeholder={`${MANUAL_CODE_PREFIX}… (generated)`} aria-invalid={!!errors.code} />
            <FieldError>{errors.code}</FieldError>
          </div>
        )}
        <div>
          <Label htmlFor="ev-date">Date (optional)</Label>
          <Input id="ev-date" type="date" value={value.date} onChange={(e) => set("date", e.target.value)} aria-invalid={!!errors.date} />
          <FieldError>{errors.date}</FieldError>
        </div>
      </div>
      <div>
        <Label htmlFor="ev-source">Where the scores came from (optional link)</Label>
        <Input id="ev-source" type="url" inputMode="url" value={value.sourceUrl} onChange={(e) => set("sourceUrl", e.target.value)} placeholder="https://" aria-invalid={!!errors.sourceUrl} />
        <FieldError>{errors.sourceUrl}</FieldError>
      </div>
    </div>
  );
}

export const emptyEventForm = (): EventFormInput => ({ name: "", code: "", date: "", sourceUrl: "", defaultVideoUrl: "" });

/** Create a manual event, or (with `event`) edit one's details — including its default video. Mount with a fresh `key` per open. */
export function ManualEventDialog({
  open,
  onOpenChange,
  actor,
  existingEvents,
  event,
  eventMatchIds,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  actor: Actor;
  existingEvents: LibraryEvent[];
  /** Set to edit an existing manual event. */
  event?: LibraryEvent;
  /** Ids of the event's matches, so a rename can be copied onto them. */
  eventMatchIds?: string[];
  onSaved?: (code: string) => void;
}) {
  const editing = !!event;
  const [form, setForm] = useState<EventFormInput>(
    event ? { name: event.eventName, code: event.eventCode, date: event.date ?? "", sourceUrl: event.sourceUrl ?? "", defaultVideoUrl: event.defaultVideoUrl ?? "" } : emptyEventForm()
  );
  const [seasonId, setSeasonId] = useState(event?.seasonId || DEFAULT_SEASON_ID);
  const [errors, setErrors] = useState<EventFormErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setFormError(null);
    const checked = validateEventForm(form);
    setErrors(checked.errors);
    if (!checked.ok) return;
    setBusy(true);
    try {
      if (event) {
        await updateManualEvent(actor, event, form, eventMatchIds ?? []);
        onSaved?.(event.eventCode);
        onOpenChange(false);
      } else {
        const result = await createManualEvent(actor, form, seasonId, existingEvents);
        if (!result.ok) {
          setErrors(result.fieldErrors ?? {});
          setFormError(result.error);
          return;
        }
        onSaved?.(result.event.eventCode);
        onOpenChange(false);
      }
    } catch (err) {
      console.error("couldn't save the event:", err);
      setFormError("Couldn't save the event. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="glass-overlay max-h-[90vh] w-[min(94vw,560px)] overflow-y-auto">
        <DialogTitle className="pr-8">{editing ? "Edit manual event" : "Add manual event"}</DialogTitle>
        <DialogDescription>
          {editing ? (
            <>
              <span className="font-mono text-xs">{event.eventCode}</span> — the code and season can&apos;t change.
            </>
          ) : (
            "For events whose scores aren't in the FIRST API. Its matches work everywhere an imported match does."
          )}
        </DialogDescription>

        <form
          className="mt-5 flex flex-col gap-5"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <EventFields value={form} onChange={setForm} errors={errors} seasonId={seasonId} onSeasonChange={setSeasonId} showCode={!editing} showSeason={!editing} />
          {editing && (
            <div>
              <Label htmlFor="ev-video">Default video for this event (optional)</Label>
              <Input id="ev-video" type="url" inputMode="url" value={form.defaultVideoUrl} onChange={(e) => setForm({ ...form, defaultVideoUrl: e.target.value })} placeholder="One long stream reused for every match" aria-invalid={!!errors.defaultVideoUrl} />
              <p className="mt-1.5 text-xs text-[var(--muted-foreground)]">A match with no link of its own uses this, with its own start and end times.</p>
              <FieldError>{errors.defaultVideoUrl}</FieldError>
            </div>
          )}
          {formError && (
            <p role="alert" className="text-sm text-red-300">
              {formError}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? "Saving…" : editing ? "Save" : "Add event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
