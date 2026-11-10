"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { dedupeFormImport, parseFormImportCsv, type FormImportedRow } from "@/lib/analytics/csv";
import type { GameSchema } from "@/lib/analytics/game-schema";
import type { FormEntry, NewFormEntry } from "@/lib/form-entries-model";
import type { Form } from "@/lib/forms/types";
import { normalizeValues } from "@/lib/forms/values";
import { newNote } from "@/lib/sticky-notes";

/** Import CSV for one of the new forms (admins). The same columns Export CSV writes; rows already in the table are skipped; the event comes from the file's Event column, else the page's. */
export function FormImportDialog({
  open,
  onOpenChange,
  schema,
  form,
  save,
  defaultEvent,
  existing,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: GameSchema;
  form: Form;
  /** Writes one imported row (the connected page saves it as the importing admin). */
  save: (input: NewFormEntry) => Promise<unknown>;
  defaultEvent: string;
  existing: FormEntry[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toInsert, setToInsert] = useState<FormImportedRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const reset = () => {
    setErrors([]);
    setToInsert([]);
    setSkipped(0);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    const { rows, errors: parseErrors } = parseFormImportCsv(schema, await file.text());
    setFileName(file.name);
    if (parseErrors.length > 0 && rows.length === 0) {
      setErrors(parseErrors);
      setToInsert([]);
      setSkipped(0);
      return;
    }
    const normalized = rows.map((r) => ({ ...r, values: normalizeValues(form, r.values) }));
    // compare like with like: entries saved by an older version of the form lack the newer keys, so both sides are normalized against the form
    const have = existing.map((e) => ({ ...e, values: normalizeValues(form, e.values) }));
    const { toInsert: fresh, skipped: dupes } = dedupeFormImport(normalized, have, defaultEvent);
    setErrors(parseErrors);
    setToInsert(fresh);
    setSkipped(dupes);
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      await Promise.all(
        toInsert.map((row) =>
          save({
            scoutName: row.scoutName,
            formId: form.id,
            formVersion: form.version,
            formType: form.formType as FormEntry["formType"],
            eventCode: row.eventCode ?? defaultEvent,
            ...(row.matchKey !== null ? { matchKey: row.matchKey } : {}),
            ...(row.alliance !== null ? { alliance: row.alliance } : {}),
            ...(row.teamNumber !== null ? { teamNumber: row.teamNumber } : {}),
            values: row.values,
            stickyNotes: row.notes.map((text) => ({ ...newNote(), text })),
          })
        )
      );
      onOpenChange(false);
      reset();
    } finally {
      setImporting(false);
    }
  };

  const usable = errors.length === 0 || toInsert.length > 0 || skipped > 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="max-h-[85vh] w-[min(92vw,680px)] overflow-y-auto">
        <DialogTitle>Import CSV</DialogTitle>
        <DialogDescription>Same column format as Export CSV. Rows already in the table are skipped. Rows without an Event column go to {defaultEvent}.</DialogDescription>
        <div className="mt-4 flex flex-col gap-4">
          <input ref={fileInputRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="form-import-file" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          <Button variant="glass" size="lg" className="gap-2 self-start" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Choose CSV file
          </Button>
          {fileName && <p className="text-sm text-[var(--muted-foreground)]">{fileName}</p>}
          {errors.length > 0 && (
            <div className="glass-card flex flex-col gap-1 p-4 text-sm text-red-300" data-testid="form-import-errors">
              {errors.slice(0, 8).map((e) => (
                <p key={e}>{e}</p>
              ))}
              {errors.length > 8 && <p>…and {errors.length - 8} more.</p>}
            </div>
          )}
          {fileName && usable && (
            <>
              <p className="text-sm text-[var(--muted-foreground)]" data-testid="form-import-summary">
                <span className="font-semibold text-[var(--foreground)]">{toInsert.length}</span> new row{toInsert.length === 1 ? "" : "s"} to import, <span className="font-semibold text-[var(--foreground)]">{skipped}</span> duplicate{skipped === 1 ? "" : "s"} skipped.
              </p>
              {toInsert.length > 0 && (
                <Table>
                  <THead>
                    <TR>
                      <TH>Team / match</TH>
                      <TH>Scout</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {toInsert.slice(0, 8).map((r, i) => (
                      <TR key={i}>
                        <TD>{[r.teamNumber !== null ? `Team ${r.teamNumber}` : null, r.matchKey, r.alliance].filter(Boolean).join(" · ") || "—"}</TD>
                        <TD>{r.scoutName}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {toInsert.length > 8 && <p className="text-xs text-[var(--muted-foreground)]">...and {toInsert.length - 8} more.</p>}
              <Button size="lg" disabled={toInsert.length === 0 || importing} onClick={confirmImport} data-testid="form-import-confirm">
                {importing ? "Importing…" : `Import ${toInsert.length} row${toInsert.length === 1 ? "" : "s"}`}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
