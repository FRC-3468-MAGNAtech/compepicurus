"use client";

import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { dedupeAgainstExisting, parseImportCsv, type ImportedRow } from "@/lib/analytics/csv";
import { formatMatch } from "@/lib/analytics/game-schema";
import { computeScore, saveEntry, type ScoutEntry } from "@/lib/scout-entries";
import type { GameSchema } from "@/lib/analytics/game-schema";

export function ImportCsvDialog({
  open,
  onOpenChange,
  schema,
  eventCode,
  existingEntries,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schema: GameSchema;
  eventCode: string;
  existingEntries: ScoutEntry[];
  onImported: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [toInsert, setToInsert] = useState<ImportedRow[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [fileName, setFileName] = useState<string | null>(null);

  const reset = () => {
    setErrors([]);
    setToInsert([]);
    setSkipped(0);
    setFileName(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    const text = await file.text();
    const { rows, errors: parseErrors } = parseImportCsv(schema, text);
    setFileName(file.name);
    if (parseErrors.length > 0) {
      setErrors(parseErrors);
      setToInsert([]);
      setSkipped(0);
      return;
    }
    const { toInsert: fresh, skipped: dupes } = dedupeAgainstExisting(rows, existingEntries);
    setErrors([]);
    setToInsert(fresh);
    setSkipped(dupes);
  };

  const confirmImport = () => {
    for (const row of toInsert) {
      saveEntry({
        scoutName: row.scoutName,
        eventCode,
        matchType: row.matchType,
        matchNumber: row.matchNumber,
        teamNumber: row.teamNumber,
        fields: row.fields,
        score: computeScore(row.fields),
        comments: row.comments,
      });
    }
    onImported();
    onOpenChange(false);
    reset();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="w-[min(92vw,680px)] max-h-[85vh] overflow-y-auto">
        <DialogTitle>Import CSV</DialogTitle>
        <DialogDescription>Same column format as Export CSV. Duplicates (same match + team + scout) are skipped.</DialogDescription>

        <div className="mt-4 flex flex-col gap-4">
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <Button variant="glass" size="lg" className="gap-2 self-start" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Choose CSV file
          </Button>
          {fileName && <p className="text-sm text-[var(--muted-foreground)]">{fileName}</p>}

          {errors.length > 0 && (
            <div className="glass-card flex flex-col gap-1 p-4 text-sm text-red-300">
              {errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          )}

          {fileName && errors.length === 0 && (
            <>
              <p className="text-sm text-[var(--muted-foreground)]">
                <span className="font-semibold text-[var(--foreground)]">{toInsert.length}</span> new row
                {toInsert.length === 1 ? "" : "s"} to import, <span className="font-semibold text-[var(--foreground)]">{skipped}</span>{" "}
                duplicate{skipped === 1 ? "" : "s"} skipped.
              </p>
              {toInsert.length > 0 && (
                <Table>
                  <THead>
                    <TR>
                      <TH>Match</TH>
                      <TH>Team</TH>
                      <TH>Scout</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {toInsert.slice(0, 8).map((r, i) => (
                      <TR key={i}>
                        <TD>{formatMatch({ matchType: r.matchType, matchNumber: r.matchNumber })}</TD>
                        <TD>{r.teamNumber}</TD>
                        <TD>{r.scoutName}</TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
              {toInsert.length > 8 && (
                <p className="text-xs text-[var(--muted-foreground)]">...and {toInsert.length - 8} more.</p>
              )}
              <Button size="lg" disabled={toInsert.length === 0} onClick={confirmImport}>
                Import {toInsert.length} row{toInsert.length === 1 ? "" : "s"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
