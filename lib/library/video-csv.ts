import { parseCsv } from "@/lib/analytics/csv";
import { parseTimeInput } from "@/lib/library/time";

// The Admin Panel's "bulk import video CSV" (matchKey,url,startSec,endSec), parsed. Pure.

export type VideoCsvRow = { matchKey: string; youtubeUrl: string; startSec: number | null; endSec: number | null };

/**
 * Parses `matchKey,url,startSec,endSec` rows (optionally with that header on line 1 — skipped if present).
 * FIX3: startSec and endSec may each be blank (and may be written 90, 1:30, or 1:02:30); a row is only
 * rejected for an unreadable time, or when both are given and the end isn't after the start.
 */
export function parseVideoCsv(text: string): { rows: VideoCsvRow[]; errors: string[] } {
  const table = parseCsv(text);
  const errors: string[] = [];
  const rows: VideoCsvRow[] = [];
  const startIndex = table[0]?.[0]?.trim().toLowerCase() === "matchkey" ? 1 : 0;

  for (let i = startIndex; i < table.length; i++) {
    const raw = table[i];
    const [matchKey, youtubeUrl, startSecStr = "", endSecStr = ""] = raw;
    const startSec = startSecStr.trim() === "" ? null : parseTimeInput(startSecStr);
    const endSec = endSecStr.trim() === "" ? null : parseTimeInput(endSecStr);
    const startBad = startSecStr.trim() !== "" && startSec === null;
    const endBad = endSecStr.trim() !== "" && endSec === null;
    const orderBad = startSec !== null && endSec !== null && endSec <= startSec;
    if (!matchKey || !youtubeUrl || startBad || endBad || orderBad) {
      errors.push(`Row ${i + 1}: couldn't read matchKey/url/startSec/endSec (the times may be blank, but must be readable and start < end).`);
      continue;
    }
    rows.push({ matchKey: matchKey.trim(), youtubeUrl: youtubeUrl.trim(), startSec, endSec });
  }
  return { rows, errors };
}
