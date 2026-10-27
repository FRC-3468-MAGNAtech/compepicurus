"use client";

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { CounterControl } from "@/components/scout/counter-control";
import { FieldToggle } from "@/components/scout/field-toggle";
import { CheckboxTile } from "@/components/scout/checkbox-tile";
import { formatMatch } from "@/lib/analytics/game-schema";
import { logAuditEvent } from "@/lib/audit-log";
import {
  calculateScore,
  getFormSchema,
  scoutEntryFieldsToValues,
  valuesToScoutEntryFields,
  type FieldValue,
  type FormValues,
} from "@/lib/scout-form/schema";
import { updateEntry, type ScoutEntry } from "@/lib/scout-entries";

/**
 * Admin-only raw field editor, for bug fixes — the original values are
 * never lost: `auditLog` is write-once (see firestore.rules), and this
 * writes the full before/after `{fields, comments, score}` snapshot on
 * every save, so the history is always recoverable from the Audit Log tab.
 */
export function EntryEditDialog({
  entry,
  open,
  onOpenChange,
  teamId,
  actorUid,
  actorName,
  onSaved,
}: {
  entry: ScoutEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  teamId: string;
  actorUid: string;
  actorName: string;
  onSaved?: () => void;
}) {
  const [values, setValues] = useState<FormValues>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!entry) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues({ ...scoutEntryFieldsToValues(entry.fields), comments: entry.comments } as FormValues);
  }, [entry]);

  if (!entry) return null;
  const schema = getFormSchema(entry.formId);
  const setFieldValue = (key: string, value: FieldValue) => setValues((v) => ({ ...v, [key]: value }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const fields = valuesToScoutEntryFields(values);
      const comments = String(values.comments ?? entry.comments);
      const score = calculateScore(schema, values);
      await updateEntry(entry.id, { fields, comments, score });
      await logAuditEvent(
        teamId,
        actorUid,
        actorName,
        "edit-entry",
        { entryId: entry.id, matchLabel: formatMatch(entry), teamNumber: entry.teamNumber },
        { fields: entry.fields, comments: entry.comments, score: entry.score },
        { fields, comments, score }
      );
      onSaved?.();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(92vw,560px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Edit entry</DialogTitle>
        <DialogDescription>
          {formatMatch(entry)} &bull; Team {entry.teamNumber} &bull; {entry.scoutName}
        </DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          {schema.sections.map((section) => (
            <div key={section.id} className="flex flex-col gap-3">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{section.label}</h3>
              <div className="flex flex-wrap gap-2">
                {(section.fields ?? section.groups?.flatMap((g) => g.fields) ?? []).map((field) => {
                  if (field.type === "toggle") {
                    return (
                      <FieldToggle
                        key={field.key}
                        label={field.label}
                        pointsWhenOn={field.points ?? 0}
                        checked={Boolean(values[field.key])}
                        onChange={(v) => setFieldValue(field.key, v)}
                      />
                    );
                  }
                  if (field.type === "counter") {
                    return (
                      <CounterControl
                        key={field.key}
                        label={field.label}
                        pointsPer={field.points ?? 0}
                        value={Number(values[field.key]) || 0}
                        onChange={(v) => setFieldValue(field.key, v)}
                      />
                    );
                  }
                  if (field.type === "checkbox") {
                    return (
                      <CheckboxTile
                        key={field.key}
                        label={field.label}
                        checked={Boolean(values[field.key])}
                        onChange={(v) => setFieldValue(field.key, v)}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            </div>
          ))}

          <div>
            <Label htmlFor="edit-comments">Comments</Label>
            <Textarea
              id="edit-comments"
              rows={3}
              value={String(values.comments ?? "")}
              onChange={(e) => setFieldValue("comments", e.target.value)}
            />
          </div>

          <Button size="lg" disabled={saving} onClick={handleSave}>
            {saving ? "Saving…" : "Save & Recalculate Score"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
