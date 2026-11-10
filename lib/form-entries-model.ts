import { serverTimestamp } from "firebase/firestore";
import type { FormType, FormValues, StickyNote } from "@/lib/forms/types";
import type { MatchType } from "@/lib/ftc/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import { derivedComments } from "@/lib/scout-entries";
import { MATCH_TYPE_PREFIX } from "@/lib/analytics/game-schema";

// P27: `formEntries/{entryId}`: one entry of one of the team's non-match-scout forms (Lead Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection,
// Helper, custom). Match Scout entries stay in `scoutEntries`. Pure (no Firestore client): the hooks are in lib/form-entries.ts.

export type FormEntryType = Exclude<FormType, "match-scout">;

export type FormEntryFlag = { id: string; reason: string; note?: string; addedAt: string };

export type FormEntry = {
  id: string;
  teamId: string;
  uid: string;
  scoutName: string;
  formId: string;
  formVersion: number;
  formType: FormEntryType;
  eventCode: string;
  /** "Q12", "P3", "F2": see `formMatchKey`. Absent on forms with no match (pit scouting). */
  matchKey?: string | null;
  alliance?: "red" | "blue" | null;
  teamNumber?: number | null;
  values: FormValues;
  stickyNotes: StickyNote[];
  /** For a plan-versus-actual form: the entry it was prefilled from, and how many answers differed when it was submitted. */
  linkedEntryId?: string | null;
  planDifferences?: number;
  flags: FormEntryFlag[];
  excluded: boolean;
  createdAtMs: number;
  updatedAtMs: number;
};

/** The match as one short key, the way scouts say it: P1, Q12, F3 (every playoff match is F, as everywhere else). */
export const formMatchKey = (matchType: MatchType, matchNumber: number): string => `${MATCH_TYPE_PREFIX[matchType]}${matchNumber}`;

const PREFIX_TO_TYPE: Record<string, MatchType> = { P: "Practice", Q: "Qualification", F: "Playoff" };

export function parseFormMatchKey(key: string | null | undefined): { matchType: MatchType; matchNumber: number } | null {
  const m = /^([PQF])(\d{1,4})$/.exec(key ?? "");
  return m ? { matchType: PREFIX_TO_TYPE[m[1]], matchNumber: Number(m[2]) } : null;
}

export type NewFormEntry = {
  scoutName: string;
  formId: string;
  formVersion: number;
  formType: FormEntryType;
  eventCode: string;
  matchKey?: string | null;
  alliance?: "red" | "blue" | null;
  teamNumber?: number | null;
  values: FormValues;
  stickyNotes?: StickyNote[];
  linkedEntryId?: string | null;
  planDifferences?: number;
};

/**
 * The document `saveFormEntry` writes (and the rules validate): the entry's own fields, who wrote it and for which team, empty flags, not excluded, and server
 * timestamps. Optional parts are only present when given (Firestore refuses `undefined`).
 */
export function formEntryDoc(teamId: string, uid: string, input: NewFormEntry, now: () => unknown = serverTimestamp): Record<string, unknown> {
  return {
    teamId,
    uid,
    scoutName: input.scoutName,
    formId: input.formId,
    formVersion: input.formVersion,
    formType: input.formType,
    eventCode: input.eventCode,
    ...(input.matchKey !== undefined ? { matchKey: input.matchKey } : {}),
    ...(input.alliance !== undefined ? { alliance: input.alliance } : {}),
    ...(input.teamNumber !== undefined ? { teamNumber: input.teamNumber } : {}),
    values: input.values,
    stickyNotes: input.stickyNotes ?? [],
    ...(input.linkedEntryId !== undefined ? { linkedEntryId: input.linkedEntryId } : {}),
    ...(input.planDifferences !== undefined ? { planDifferences: input.planDifferences } : {}),
    flags: [],
    excluded: false,
    createdAt: now(),
    updatedAt: now(),
  };
}

const toMs = (v: unknown): number => (v && typeof v === "object" && "toMillis" in v && typeof (v as { toMillis: unknown }).toMillis === "function" ? (v as { toMillis: () => number }).toMillis() : typeof v === "number" ? v : 0);

/** The keys whose stored value differs between two entries' values (for the audit log: it lists what changed, not the whole entry twice). */
export function diffEntryValues(before: FormValues, after: FormValues): string[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null)).sort();
}

/** A stored document as a `FormEntry` (tolerant: a missing field gets its neutral value). */
export function toFormEntry(id: string, data: Record<string, unknown>): FormEntry {
  return {
    id,
    teamId: String(data.teamId ?? ""),
    uid: String(data.uid ?? ""),
    scoutName: String(data.scoutName ?? ""),
    formId: String(data.formId ?? ""),
    formVersion: typeof data.formVersion === "number" ? data.formVersion : 0,
    formType: (data.formType as FormEntryType) ?? "custom",
    eventCode: String(data.eventCode ?? ""),
    matchKey: typeof data.matchKey === "string" ? data.matchKey : null,
    alliance: data.alliance === "red" || data.alliance === "blue" ? data.alliance : null,
    teamNumber: typeof data.teamNumber === "number" ? data.teamNumber : null,
    values: data.values && typeof data.values === "object" ? (data.values as FormValues) : {},
    stickyNotes: Array.isArray(data.stickyNotes) ? (data.stickyNotes as StickyNote[]) : [],
    linkedEntryId: typeof data.linkedEntryId === "string" ? data.linkedEntryId : null,
    planDifferences: typeof data.planDifferences === "number" ? data.planDifferences : undefined,
    flags: Array.isArray(data.flags) ? (data.flags as FormEntryFlag[]) : [],
    excluded: data.excluded === true,
    createdAtMs: toMs(data.createdAt),
    updatedAtMs: toMs(data.updatedAt),
  };
}

/**
 * A form entry as the row Analytics tables and CSV export read (a `ScoutEntry`): the match from `matchKey`, the team (0 when the form has none), the values,
 * the notes, and no score (these forms don't score, so `scored: false` and accuracy is "n/a"). This is what lets the same table, filters and CSV code show
 * every form's entries.
 */
export function formEntryToRow(entry: FormEntry, form?: Parameters<typeof derivedComments>[0]): ScoutEntry {
  const match = parseFormMatchKey(entry.matchKey);
  return {
    id: entry.id,
    teamId: entry.teamId,
    uid: entry.uid,
    source: "event",
    mode: null,
    formId: entry.formId,
    formVersion: entry.formVersion,
    scoutName: entry.scoutName,
    eventCode: entry.eventCode,
    matchType: match?.matchType ?? "Practice",
    matchNumber: match?.matchNumber ?? 0,
    teamNumber: entry.teamNumber ?? 0,
    values: entry.values,
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    scored: false,
    comments: form ? derivedComments(form, entry.values, entry.stickyNotes) : entry.stickyNotes.map((n) => n.text).filter(Boolean).join(" | "),
    stickyNotes: entry.stickyNotes,
    alliance: entry.alliance ?? null,
    linkedEntryId: entry.linkedEntryId ?? null,
    planDifferences: entry.planDifferences,
    submittedAt: new Date(entry.createdAtMs || 0).toISOString(),
    excluded: entry.excluded,
    autoFlags: [],
    // P30: an admin's flags show in the same Config modal as a Match Scout entry's manual flags
    manualFlags: entry.flags.map((f) => ({ id: f.id, reason: f.reason as ScoutEntry["manualFlags"][number]["reason"], note: f.note, addedAt: f.addedAt })),
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
  };
}
