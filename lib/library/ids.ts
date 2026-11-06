import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";
import type { MatchType } from "@/lib/ftc/types";

// Ids, event codes, and the API/manual origin rule for the match library
// (P3, extended by P15). Pure.

export function libraryMatchId(eventCode: string, matchType: MatchType, matchNumber: number): string {
  return `${eventCode}_${MATCH_TYPE_PREFIX[matchType]}${matchNumber}`;
}

/** "P" / "Q" / "F" (any case) or the full words → a MatchType; null when it isn't one. */
export function parseMatchType(input: string): MatchType | null {
  const t = input.trim().toLowerCase();
  if (t === "p" || t === "practice") return "Practice";
  if (t === "q" || t === "qual" || t === "quals" || t === "qualification" || t === "qualifications") return "Qualification";
  if (t === "f" || t === "final" || t === "finals" || t === "playoff" || t === "playoffs") return "Playoff";
  return null;
}

// --- origin -----------------------------------------------------------------------

export type LibraryOrigin = "api" | "manual";

/** A doc with no `origin` predates P15 and came from the API. */
export const originOf = (doc: { origin?: unknown } | null | undefined): LibraryOrigin => (doc?.origin === "manual" ? "manual" : "api");

export type WriteDecision = "create" | "update" | "skip-other-origin";

/**
 * The one rule both write paths share: a manual write never touches an
 * API-origin match, and an API import/refresh never touches a manual one
 * (firestore.rules enforces it too — `origin` can't change on an existing doc).
 */
export function decideMatchWrite(existing: { origin?: unknown } | null, writer: LibraryOrigin): WriteDecision {
  if (!existing) return "create";
  return originOf(existing) === writer ? "update" : "skip-other-origin";
}

// --- manual event codes ---------------------------------------------------------------

export const MANUAL_CODE_PREFIX = "MAN-";
const MIN_CODE = 3;
const MAX_CODE = 24;

/** Uppercases, turns spaces/underscores into hyphens, drops anything else that isn't A-Z, 0-9 or "-". */
export function normalizeEventCode(input: string): string {
  return input
    .trim()
    .toUpperCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * A code an admin typed themself. `taken` holds every code already in use by
 * any event (API or manual) in any case. No underscores — the match id is
 * `${eventCode}_${type}${number}` and an underscore in the code would make it ambiguous.
 */
export function validateEventCode(input: string, taken: ReadonlySet<string>): { ok: true; code: string } | { ok: false; error: string } {
  if (/_/.test(input)) return { ok: false, error: "Event codes can't contain underscores." };
  const code = normalizeEventCode(input);
  if (code.length < MIN_CODE || code.length > MAX_CODE) return { ok: false, error: `Use ${MIN_CODE}-${MAX_CODE} letters, numbers, or hyphens.` };
  if ([...taken].some((t) => t.toUpperCase() === code)) return { ok: false, error: `The code ${code} is already used by another event.` };
  return { ok: true, code };
}

/** `MAN-` plus a short slug of the name, made unique (`-2`, `-3`, …) against `taken`. */
export function generateManualEventCode(name: string, taken: ReadonlySet<string>): string {
  const slug = name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "")
    .slice(0, 10);
  const base = `${MANUAL_CODE_PREFIX}${slug || "EVENT"}`;
  const takenUpper = new Set([...taken].map((t) => t.toUpperCase()));
  if (!takenUpper.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!takenUpper.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}
