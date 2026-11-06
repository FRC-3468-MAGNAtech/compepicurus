import { parseCsv, serializeCsv } from "@/lib/analytics/csv";
import type { MatchType } from "@/lib/ftc/types";
import { originOf, type LibraryOrigin } from "@/lib/library/ids";
import { manualMatchId, matchLabel, validateRawMatch, type EventRef, type RawField, type RawMatch, type ValidMatch } from "@/lib/library/manual-match";

// Bulk entry for ONE event (P15): a CSV file or text pasted from a spreadsheet,
// validated row by row before anything is saved. Pure. The event is chosen
// once by the caller and applied to every row — there is no event column to
// repeat (an optional `eventCode` column is allowed, but must match).

/** The template's columns, in order. `eventCode` is optional and not part of it. */
export const BULK_COLUMNS = ["matchType", "matchNumber", "red1", "red2", "blue1", "blue2", "redScore", "blueScore", "redPenalty", "bluePenalty", "youtubeUrl", "startSec", "endSec", "notes"] as const;
type BulkColumn = (typeof BULK_COLUMNS)[number] | "eventCode";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

const HEADER_ALIASES: Record<string, BulkColumn> = {
  ...Object.fromEntries([...BULK_COLUMNS, "eventCode"].map((c) => [norm(c), c as BulkColumn])),
  type: "matchType",
  match: "matchNumber",
  matchno: "matchNumber",
  number: "matchNumber",
  url: "youtubeUrl",
  youtube: "youtubeUrl",
  video: "youtubeUrl",
  start: "startSec",
  end: "endSec",
  event: "eventCode",
};

const REQUIRED_COLUMNS: BulkColumn[] = ["matchNumber", "red1", "red2", "blue1", "blue2", "redScore", "blueScore"];

const FIELD_FOR_COLUMN: Record<Exclude<BulkColumn, "eventCode">, RawField> = {
  matchType: "matchType",
  matchNumber: "matchNumber",
  red1: "red1",
  red2: "red2",
  blue1: "blue1",
  blue2: "blue2",
  redScore: "redScore",
  blueScore: "blueScore",
  redPenalty: "redPenalty",
  bluePenalty: "bluePenalty",
  youtubeUrl: "youtubeUrl",
  startSec: "start",
  endSec: "end",
  notes: "notes",
};

const FIELD_LABELS: Record<RawField, string> = {
  matchType: "Match type",
  matchNumber: "Match number",
  red1: "Red 1",
  red2: "Red 2",
  blue1: "Blue 1",
  blue2: "Blue 2",
  redScore: "Red score",
  blueScore: "Blue score",
  redPenalty: "Red penalty",
  bluePenalty: "Blue penalty",
  youtubeUrl: "YouTube link",
  start: "Start",
  end: "End",
  notes: "Notes",
};

export type BulkDefaults = {
  /** Applied when a row's matchType is blank (or the column is absent). */
  matchType: MatchType | null;
  /** Applied when a row has no link of its own. */
  youtubeUrl: string;
};

export type BulkRowAction = "create" | "update";

export type BulkRow = {
  /** The line in the pasted/uploaded text (1-based; the header line counts). */
  rowNumber: number;
  raw: RawMatch;
  /** Blocking problems. Empty = the row can be imported. */
  errors: string[];
  /** Non-blocking notes (e.g. replaced by a later duplicate row). */
  warnings: string[];
  match: ValidMatch | null;
  id: string | null;
  /** create = a new match; update = it replaces an existing manual match. Null when the row has errors. */
  action: BulkRowAction | null;
  /** True when a later row in the same file has the same match id — that row wins, this one is skipped. */
  superseded: boolean;
};

export type BulkResult = {
  /** Problems with the file's shape (missing columns). When non-empty there are no rows. */
  columnErrors: string[];
  hasHeader: boolean;
  rows: BulkRow[];
};

export function bulkTemplateCsv(): string {
  return serializeCsv([
    [...BULK_COLUMNS],
    ["Q", "1", "254", "971", "118", "1114", "142", "98", "6", "0", "", "", "", ""],
    ["Q", "2", "6672", "8110", "3468", "7244", "76", "104", "0", "12", "", "", "", "Example row — replace or delete"],
  ]);
}

/** Splits pasted/uploaded text into cells: tab-separated (a spreadsheet paste) when the first line has a tab, otherwise comma-separated. */
export function splitBulkText(text: string): string[][] {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return parseCsv(text, firstLine.includes("\t") ? "\t" : ",");
}

function detectHeader(first: string[] | undefined): BulkColumn[] | null {
  if (!first) return null;
  const mapped = first.map((c) => HEADER_ALIASES[norm(c)] ?? null);
  // A real header names at least three known columns; a data row never will.
  if (mapped.filter(Boolean).length < 3) return null;
  return mapped as BulkColumn[];
}

export type BulkInput = {
  text: string;
  /** The target event's code — every row belongs to it. */
  event: Pick<EventRef, "eventCode">;
  defaults: BulkDefaults;
  /** Ids already in the target event, with their origin — to tell create from update and refuse to overwrite API matches. */
  existing: ReadonlyMap<string, { origin?: unknown }>;
};

export function validateBulk({ text, event, defaults, existing }: BulkInput): BulkResult {
  const table = splitBulkText(text);
  if (table.length === 0) return { columnErrors: ["Nothing to import — paste some rows or choose a file."], hasHeader: false, rows: [] };

  const headerColumns = detectHeader(table[0]);
  const dataStart = headerColumns ? 1 : 0;
  // Without a header the columns are the template's, in order.
  const columns: (BulkColumn | null)[] = headerColumns ?? [...BULK_COLUMNS];

  const columnErrors: string[] = [];
  if (headerColumns) {
    const present = new Set(headerColumns.filter(Boolean));
    for (const col of REQUIRED_COLUMNS) if (!present.has(col)) columnErrors.push(`Missing column: ${col}.`);
    if (!present.has("matchType") && !defaults.matchType) columnErrors.push("Missing column: matchType (or choose a default match type).");
  }
  if (columnErrors.length > 0) return { columnErrors, hasHeader: true, rows: [] };

  const rows: BulkRow[] = [];
  for (let i = dataStart; i < table.length; i++) {
    const cells = table[i];
    if (cells.every((c) => c.trim() === "")) continue;

    const raw: RawMatch = { matchType: "", matchNumber: "", red1: "", red2: "", blue1: "", blue2: "", redScore: "", blueScore: "", redPenalty: "", bluePenalty: "", youtubeUrl: "", start: "", end: "", notes: "" };
    let rowEventCode = "";
    columns.forEach((col, c) => {
      if (!col) return;
      const value = (cells[c] ?? "").trim();
      if (col === "eventCode") rowEventCode = value;
      else raw[FIELD_FOR_COLUMN[col]] = value;
    });

    const errors: string[] = [];
    const result = validateRawMatch(raw, { defaultVideoUrl: defaults.youtubeUrl, defaultMatchType: defaults.matchType });
    for (const [field, message] of Object.entries(result.errors)) errors.push(`${FIELD_LABELS[field as RawField]}: ${message}`);
    if (rowEventCode !== "" && rowEventCode.toUpperCase() !== event.eventCode.toUpperCase()) {
      errors.push(`Event: this row's eventCode "${rowEventCode}" doesn't match the target event ${event.eventCode}. Leave it blank or fix it.`);
    }

    let id: string | null = null;
    let action: BulkRowAction | null = null;
    if (result.match) {
      id = manualMatchId(event, result.match);
      const existingDoc = existing.get(id);
      if (existingDoc && originOf(existingDoc) !== "manual") {
        errors.push(`${matchLabel(result.match)} already exists as an imported (API) match, which manual entry never overwrites.`);
      } else if (errors.length === 0) {
        action = existingDoc ? "update" : "create";
      }
    }
    rows.push({ rowNumber: i + 1, raw, errors, warnings: [], match: errors.length === 0 ? result.match : null, id, action, superseded: false });
  }

  // The same match twice in one file: the later row wins, and the earlier ones say so.
  const validById = new Map<string, BulkRow[]>();
  for (const row of rows) {
    if (!row.id || row.errors.length > 0) continue;
    validById.set(row.id, [...(validById.get(row.id) ?? []), row]);
  }
  for (const group of validById.values()) {
    if (group.length < 2) continue;
    const winner = group[group.length - 1];
    for (const earlier of group.slice(0, -1)) {
      earlier.superseded = true;
      earlier.warnings.push(`Same match as row ${winner.rowNumber} — that later row will be used instead.`);
    }
    winner.warnings.push(`Same match as row ${group.slice(0, -1).map((r) => r.rowNumber).join(", ")} — this later row is the one that will be used.`);
  }

  return { columnErrors: [], hasHeader: headerColumns !== null, rows };
}

export type BulkSummary = { total: number; valid: number; errors: number; creates: number; updates: number; superseded: number; importable: BulkRow[] };

export function summarizeBulk(result: BulkResult): BulkSummary {
  const importable = result.rows.filter((r) => r.errors.length === 0 && r.match && !r.superseded);
  return {
    total: result.rows.length,
    valid: result.rows.filter((r) => r.errors.length === 0).length,
    errors: result.rows.filter((r) => r.errors.length > 0).length,
    creates: importable.filter((r) => r.action === "create").length,
    updates: importable.filter((r) => r.action === "update").length,
    superseded: result.rows.filter((r) => r.superseded).length,
    importable,
  };
}

/** Re-exported for callers that only need the origin type alongside bulk results. */
export type { LibraryOrigin };
