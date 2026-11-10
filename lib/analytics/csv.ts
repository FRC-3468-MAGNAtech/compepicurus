import { csvHeaderFor, type AnalyticsColumn, type GameSchema } from "@/lib/analytics/game-schema";
import type { ScoutEntry } from "@/lib/scout-entries";
import { coerceFieldValue } from "@/lib/forms/values";
import type { FormValues } from "@/lib/forms/types";
import type { MatchType } from "@/lib/ftc/types";

// --- Low-level RFC4180 CSV -------------------------------------------------

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

/** `delimiter` is a comma by default; pass "	" for text pasted from a spreadsheet (P15). Quoting works the same either way. */
export function parseCsv(text: string, delimiter: string = ","): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += char;
      i++;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\r") {
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += char;
    i++;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ""));
}

// --- Export -----------------------------------------------------------------

export function exportableColumns(schema: GameSchema): AnalyticsColumn[] {
  return schema.columns.filter((c) => c.type !== "actions");
}

function formatCellForCsv(col: AnalyticsColumn, entry: ScoutEntry, displayScoutName: string): string {
  if (col.type === "scoutName") return displayScoutName;
  const raw = col.getValue(entry);
  if (raw === null || raw === undefined) return "";
  if (col.type === "boolean") return raw ? "Y" : "N";
  if (col.type === "accuracy") return `${Math.round((raw as number) * 100)}%`;
  return String(raw);
}

export function entriesToCsv(
  schema: GameSchema,
  entries: ScoutEntry[],
  resolveDisplayName: (scoutName: string) => string
): string {
  const cols = exportableColumns(schema);
  const header = cols.map(csvHeaderFor);
  const rows = entries.map((e) => cols.map((c) => formatCellForCsv(c, e, resolveDisplayName(e.scoutName))));
  return serializeCsv([header, ...rows]);
}

// --- Import -------------------------------------------------------------

const MATCH_PREFIX_TO_TYPE: Record<string, MatchType> = { P: "Practice", Q: "Qualification", F: "Playoff" };

function parseMatchString(value: string): { type: MatchType; number: number } | null {
  const m = /^([PQF])(\d+)$/.exec(value.trim());
  if (!m) return null;
  return { type: MATCH_PREFIX_TO_TYPE[m[1]], number: Number(m[2]) };
}

export type ImportedRow = {
  scoutName: string;
  matchType: MatchType;
  matchNumber: number;
  teamNumber: number;
  /** The form-field cells of the row, coerced to each field's type (P21). Normalize against the form (`normalizeValues`) before saving: it fills anything the file didn't have. */
  values: FormValues;
};

export type ImportResult = { rows: ImportedRow[]; errors: string[] };

/** Only the *input* columns (match/team/scout/fields/comments) are imported — score, accuracy, and script status are always recomputed, never trusted from the file. */
export function parseImportCsv(schema: GameSchema, csvText: string): ImportResult {
  const table = parseCsv(csvText);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const header = table[0];
  // P21: the input columns are Match / Team / Scout plus every column derived from a form field; score, accuracy and script status are recomputed.
  const inputCols = exportableColumns(schema).filter((c) => !c.derived && (!!c.field || c.key === "match" || c.key === "team" || c.key === "scout"));
  const colIndexByKey = new Map<string, number>();
  for (const col of inputCols) {
    const idx = header.indexOf(csvHeaderFor(col));
    if (idx === -1) {
      errors.push(`Missing expected column "${csvHeaderFor(col)}".`);
    } else {
      colIndexByKey.set(col.key, idx);
    }
  }
  if (errors.length > 0) return { rows: [], errors };

  const rows: ImportedRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const raw = table[r];
    const get = (key: string) => raw[colIndexByKey.get(key)!] ?? "";

    const match = parseMatchString(get("match"));
    const teamNumber = Number(get("team"));
    const scoutName = get("scout").trim();
    if (!match || !Number.isFinite(teamNumber) || !scoutName) {
      errors.push(`Row ${r + 1}: couldn't read match/team/scout.`);
      continue;
    }

    const values: FormValues = {};
    for (const col of inputCols) {
      const field = col.field;
      if (!field) continue;
      const cell = get(col.key);
      if (col.parseCell) {
        col.parseCell(cell, values);
        continue;
      }
      const storeKey = col.valueKey ?? field.key;
      if (field.type === "select" || field.type === "radio") {
        // the table and CSV show an option's label; the stored value is its value
        const opt = field.options?.find((o) => o.label === cell.trim() || o.value === cell.trim());
        values[storeKey] = coerceFieldValue(field, opt?.value ?? "");
      } else if (field.type === "textarea" || field.type === "text") {
        values[storeKey] = coerceFieldValue(field, cell);
      } else {
        values[storeKey] = coerceFieldValue(field, cell.trim());
      }
    }

    rows.push({
      scoutName,
      matchType: match.type,
      matchNumber: match.number,
      teamNumber,
      values,
    });
  }

  return { rows, errors };
}

export function dedupeAgainstExisting(rows: ImportedRow[], existing: ScoutEntry[]) {
  const existingKeys = new Set(existing.map((e) => `${e.matchType}-${e.matchNumber}-${e.teamNumber}-${e.scoutName}`));
  const toInsert: ImportedRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    const key = `${row.matchType}-${row.matchNumber}-${row.teamNumber}-${row.scoutName}`;
    if (existingKeys.has(key)) {
      skipped++;
      continue;
    }
    existingKeys.add(key);
    toInsert.push(row);
  }
  return { toInsert, skipped };
}

// --- Import for the new forms (P30) --------------------------------------------------------------------------

export type FormImportedRow = {
  scoutName: string;
  /** From the Event column when the file has one, else null (the importing page's event is used). */
  eventCode: string | null;
  teamNumber: number | null;
  matchKey: string | null;
  alliance: "red" | "blue" | null;
  values: FormValues;
  /** The Notes column, split back into sticky notes. */
  notes: string[];
};

export type FormImportResult = { rows: FormImportedRow[]; errors: string[] };

const NOTE_SEPARATOR = " | ";

/**
 * Reads a CSV exported from one of the new forms' pages. The input columns are the ones the page exported (Team and Match and Alliance where the form has them,
 * Scout, every form field, and the Notes column); computed columns (photo counts, step counts, differences from plan) are ignored. Missing a column the form needs is an
 * error, so a wrong file is caught before anything is written.
 */
export function parseFormImportCsv(schema: GameSchema, csvText: string): FormImportResult {
  const table = parseCsv(csvText);
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };
  const header = table[0];
  const cols = exportableColumns(schema);
  const need = cols.filter((c) => !c.derived && (!!c.field || ["match", "team", "scout", "alliance"].includes(c.key)));
  const index = new Map<string, number>();
  const errors: string[] = [];
  for (const col of need) {
    const idx = header.indexOf(csvHeaderFor(col));
    if (idx === -1) errors.push(`Missing expected column "${csvHeaderFor(col)}".`);
    else index.set(col.key, idx);
  }
  if (errors.length > 0) return { rows: [], errors };
  const optional = (key: string): number | undefined => {
    const col = cols.find((c) => c.key === key);
    if (!col) return undefined;
    const idx = header.indexOf(csvHeaderFor(col));
    return idx === -1 ? undefined : idx;
  };
  const eventIdx = optional("event");
  const notesIdx = optional("stickyNotes");

  const rows: FormImportedRow[] = [];
  for (let r = 1; r < table.length; r++) {
    const raw = table[r];
    if (raw.every((c) => c.trim() === "")) continue;
    const get = (key: string) => raw[index.get(key)!] ?? "";
    const scoutName = get("scout").trim();
    if (!scoutName) {
      errors.push(`Row ${r + 1}: no scout name.`);
      continue;
    }
    let matchKey: string | null = null;
    if (index.has("match")) {
      const m = parseMatchString(get("match"));
      if (!m) {
        errors.push(`Row ${r + 1}: couldn't read the match "${get("match")}".`);
        continue;
      }
      matchKey = get("match").trim();
    }
    let alliance: "red" | "blue" | null = null;
    if (index.has("alliance")) {
      const a = get("alliance").trim().toLowerCase();
      if (a !== "red" && a !== "blue") {
        errors.push(`Row ${r + 1}: the alliance must be Red or Blue.`);
        continue;
      }
      alliance = a;
    }
    let teamNumber: number | null = null;
    if (index.has("team")) {
      const t = Number(get("team"));
      if (!Number.isInteger(t) || t <= 0) {
        errors.push(`Row ${r + 1}: couldn't read the team "${get("team")}".`);
        continue;
      }
      teamNumber = t;
    }

    const values: FormValues = {};
    for (const col of need) {
      const field = col.field;
      if (!field) continue;
      const cell = get(col.key);
      if (col.parseCell) {
        col.parseCell(cell, values);
        continue;
      }
      const storeKey = col.valueKey ?? field.key;
      if (field.type === "select" || field.type === "radio") {
        const opt = field.options?.find((o) => o.label === cell.trim() || o.value === cell.trim());
        values[storeKey] = coerceFieldValue(field, opt?.value ?? "");
      } else if (field.type === "textarea" || field.type === "text") {
        values[storeKey] = coerceFieldValue(field, cell);
      } else {
        values[storeKey] = coerceFieldValue(field, cell.trim());
      }
    }
    const notes = notesIdx === undefined ? [] : (raw[notesIdx] ?? "").split(NOTE_SEPARATOR).map((n) => n.trim()).filter(Boolean);
    const eventCode = eventIdx === undefined ? null : ((raw[eventIdx] ?? "").trim() || null);
    rows.push({ scoutName, eventCode, teamNumber, matchKey, alliance, values, notes });
  }
  return { rows, errors };
}

/** Rows already in the table (same event, match, alliance, team, scout and answers) are skipped, so importing a file twice adds nothing. */
export function dedupeFormImport(rows: FormImportedRow[], existing: { eventCode: string; matchKey?: string | null; alliance?: string | null; teamNumber?: number | null; scoutName: string; values: FormValues }[], defaultEvent: string) {
  const keyOf = (e: string, m: string | null | undefined, a: string | null | undefined, t: number | null | undefined, s: string, v: FormValues) => JSON.stringify([e, m ?? null, a ?? null, t ?? null, s, v]);
  const seen = new Set(existing.map((e) => keyOf(e.eventCode, e.matchKey, e.alliance, e.teamNumber, e.scoutName, e.values)));
  const toInsert: FormImportedRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    const k = keyOf(row.eventCode ?? defaultEvent, row.matchKey, row.alliance, row.teamNumber, row.scoutName, row.values);
    if (seen.has(k)) skipped++;
    else {
      seen.add(k);
      toInsert.push(row);
    }
  }
  return { toInsert, skipped };
}
