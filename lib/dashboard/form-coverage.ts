import type { FormEntry, FormEntryType } from "@/lib/form-entries-model";

// P29: what the Pit Scout, Team Strategy and Helper dashboards say about the team's form entries at the selected event. Pure.

export type FormCoverage = { total: number; done: number; percent: number | null; missing: number[] };

/** Entries of one form type that count (not excluded), for the event's teams only when `teams` is given. */
export function entriesOfType(entries: readonly FormEntry[], formType: FormEntryType): FormEntry[] {
  return entries.filter((e) => e.formType === formType && !e.excluded);
}

/** How many of the event's teams have at least one entry of this form type (several scouts on one team count once). `missing` is sorted by team number. */
export function formCoverage(teams: readonly number[], entries: readonly FormEntry[], formType: FormEntryType): FormCoverage {
  const seen = new Set<number>();
  for (const e of entriesOfType(entries, formType)) if (typeof e.teamNumber === "number") seen.add(e.teamNumber);
  const unique = [...new Set(teams)].sort((a, b) => a - b);
  const missing = unique.filter((t) => !seen.has(t));
  const done = unique.length - missing.length;
  return { total: unique.length, done, percent: unique.length === 0 ? null : Math.round((done / unique.length) * 100), missing };
}

/** The teams a person has an entry for (their own submissions), as a set. */
export function myTeams(entries: readonly FormEntry[], formType: FormEntryType, uid: string): Set<number> {
  const out = new Set<number>();
  for (const e of entriesOfType(entries, formType)) if (e.uid === uid && typeof e.teamNumber === "number") out.add(e.teamNumber);
  return out;
}

export type HelperSummary = { total: number; successful: number; rate: number | null; recent: FormEntry[] };

/** The Helper form's log: how many assists, how many the helped scout was successful with (`successful` = "yes"), newest first. */
export function helperSummary(entries: readonly FormEntry[], limit = 5): HelperSummary {
  const list = entriesOfType(entries, "helper").sort((a, b) => b.createdAtMs - a.createdAtMs);
  const successful = list.filter((e) => e.values.successful === "yes").length;
  return { total: list.length, successful, rate: list.length === 0 ? null : Math.round((successful / list.length) * 100), recent: list.slice(0, limit) };
}
