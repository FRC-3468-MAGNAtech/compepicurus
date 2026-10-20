import type { AnalyticsColumn, GameSchema } from "@/lib/analytics/game-schema";
import { initialScoutEntryFields, type ScoutEntry, type ScoutEntryFields } from "@/lib/scout-entries";
import type { MatchType } from "@/lib/ftc/types";

// --- Low-level RFC4180 CSV -------------------------------------------------

export function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

export function serializeCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvEscape).join(",")).join("\r\n");
}

export function parseCsv(text: string): string[][] {
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
    if (char === ",") {
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
  const header = cols.map((c) => `${c.phase} - ${c.category} - ${c.label}`);
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
  comments: string;
  fields: ScoutEntryFields;
};

export type ImportResult = { rows: ImportedRow[]; errors: string[] };

/** Only the *input* columns (match/team/scout/fields/comments) are imported — score, accuracy, and script status are always recomputed, never trusted from the file. */
export function parseImportCsv(schema: GameSchema, csvText: string): ImportResult {
  const table = parseCsv(csvText);
  const errors: string[] = [];
  if (table.length === 0) return { rows: [], errors: ["The file is empty."] };

  const header = table[0];
  const inputCols = exportableColumns(schema).filter((c) => c.type !== "accuracy" && c.type !== "scriptStatus" && c.key !== "scoreAuto" && c.key !== "scoreTeleop" && c.key !== "scoreEndgame" && c.key !== "scoreTotal");
  const colIndexByKey = new Map<string, number>();
  for (const col of inputCols) {
    const idx = header.indexOf(`${col.phase} - ${col.category} - ${col.label}`);
    if (idx === -1) {
      errors.push(`Missing expected column "${col.phase} - ${col.category} - ${col.label}".`);
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

    const fields: ScoutEntryFields = { ...initialScoutEntryFields };
    for (const col of inputCols) {
      if (col.key === "match" || col.key === "team" || col.key === "scout" || col.key === "comments") continue;
      const cell = get(col.key).trim();
      if (col.type === "boolean") {
        (fields as unknown as Record<string, boolean>)[col.key] = cell.toUpperCase() === "Y";
      } else if (col.type === "count") {
        (fields as unknown as Record<string, number>)[col.key] = Number(cell) || 0;
      }
    }

    rows.push({
      scoutName,
      matchType: match.type,
      matchNumber: match.number,
      teamNumber,
      comments: get("comments"),
      fields,
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
