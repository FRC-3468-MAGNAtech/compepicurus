import { buildGameSchema, type AnalyticsColumn, type GameSchema } from "@/lib/analytics/game-schema";
import type { EventScope } from "@/lib/analytics/filters";
import type { FormEntry, FormEntryType } from "@/lib/form-entries-model";
import type { Form } from "@/lib/forms/types";

// P30: the six Analytics pages for the new forms (Lead Scout, Pit Scout, Team Strategy, Match Strategy, Drive Reflection, Helper). One registry, so the nav, the
// route pages, Scout Status and the Team Profile all agree. The raw table is the same schema-driven table Match Scout Analytics uses; these helpers shape it. Pure.

export type FormAnalyticsSlug = "lead-scout" | "pit-scout" | "team-strategy" | "match-strategy" | "drive-reflection" | "helper";

export type FormAnalyticsPage = {
  slug: FormAnalyticsSlug;
  href: string;
  title: string;
  /** The Analytics tab. */
  navLabel: string;
  formType: FormEntryType;
  /** The built-in form: what an empty page derives its columns from, and what Import CSV writes with. */
  formId: string;
  description: string;
  /** What one row is, and what the "latest only" summary keeps one of. */
  unit: "match-alliance" | "team";
  /** The Analytics page is for forms with a match / alliance column. */
  hasMatch: boolean;
  hasAlliance: boolean;
};

export const FORM_ANALYTICS_PAGES: readonly FormAnalyticsPage[] = [
  { slug: "lead-scout", href: "/analytics/lead-scout", title: "Lead Scout Analytics", navLabel: "Lead Scout", formType: "lead-scout", formId: "lead-scout-v1", description: "A lead scout's read of each alliance: notes and a 1-5 skill for the alliance and its teams.", unit: "match-alliance", hasMatch: true, hasAlliance: true },
  { slug: "pit-scout", href: "/analytics/pit-scout", title: "Pit Scout Analytics", navLabel: "Pit Scout", formType: "pit-scout", formId: "pit-scout-v1", description: "Each team's robot as seen in the pit: photos, capabilities, capacity and the auto cycle.", unit: "team", hasMatch: false, hasAlliance: false },
  { slug: "team-strategy", href: "/analytics/team-strategy", title: "Team Strategy Analytics", navLabel: "Team Strategy", formType: "team-strategy", formId: "team-strategy-v1", description: "What each team is best at and what it can do.", unit: "team", hasMatch: false, hasAlliance: false },
  { slug: "match-strategy", href: "/analytics/match-strategy", title: "Match Strategy Analytics", navLabel: "Match Strategy", formType: "match-strategy", formId: "match-strategy-v1", description: "The plan for each match: every team's role and whether it scores in auto.", unit: "match-alliance", hasMatch: true, hasAlliance: true },
  { slug: "drive-reflection", href: "/analytics/drive-reflection", title: "Drive Reflection Analytics", navLabel: "Drive Reflection", formType: "drive-reflection", formId: "drive-reflection-v1", description: "What actually happened in each match, against the plan.", unit: "match-alliance", hasMatch: true, hasAlliance: true },
  { slug: "helper", href: "/analytics/helper", title: "Helper Analytics", navLabel: "Helper", formType: "helper", formId: "helper-v1", description: "The log of helping other teams in the pit.", unit: "team", hasMatch: false, hasAlliance: false },
];

export const formAnalyticsPage = (slug: string): FormAnalyticsPage | null => FORM_ANALYTICS_PAGES.find((p) => p.slug === slug) ?? null;

/** The analytics page a path belongs to (`/analytics/pit-scout` and anything below it), or null. */
export function formAnalyticsPageForPath(pathname: string): FormAnalyticsPage | null {
  return FORM_ANALYTICS_PAGES.find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`)) ?? null;
}

/** True on the six pages: the filter bar drops its Practice toggle and Accuracy filter there (these entries have no practice mode and no accuracy). */
export const isFormAnalyticsRoute = (pathname: string): boolean => formAnalyticsPageForPath(pathname) !== null;

// --- which entries -------------------------------------------------------------------------------------------

/** The event codes an Event filter means: `null` = every event, the active events' codes for `active`, or the chosen ones. */
export function eventCodesForScope(scope: EventScope, activeCodes: readonly string[]): string[] | null {
  if (scope.kind === "all") return null;
  if (scope.kind === "custom") return scope.codes;
  return [...activeCodes];
}

/** The entries of one form type in the chosen events. Excluded entries stay when `includeExcluded` (the raw table shows and toggles them). */
export function selectFormEntries(entries: readonly FormEntry[], formType: FormEntryType, eventCodes: readonly string[] | null, opts: { includeExcluded?: boolean } = {}): FormEntry[] {
  return entries.filter((e) => e.formType === formType && (eventCodes === null || eventCodes.includes(e.eventCode)) && (opts.includeExcluded || !e.excluded));
}

/** One row's identity for "latest entry by default": a team at an event, or a match's alliance at an event. */
export function unitKey(page: Pick<FormAnalyticsPage, "unit">, e: Pick<FormEntry, "eventCode" | "teamNumber" | "matchKey" | "alliance">): string {
  return page.unit === "team" ? `${e.eventCode}|${e.teamNumber ?? ""}` : `${e.eventCode}|${e.matchKey ?? ""}|${e.alliance ?? ""}`;
}

/** Keeps the newest entry of each unit. Order of the result: newest first. */
export function latestPerUnit(page: Pick<FormAnalyticsPage, "unit">, entries: readonly FormEntry[]): FormEntry[] {
  const best = new Map<string, FormEntry>();
  for (const e of entries) {
    const k = unitKey(page, e);
    const cur = best.get(k);
    if (!cur || e.createdAtMs > cur.createdAtMs) best.set(k, e);
  }
  return [...best.values()].sort((a, b) => b.createdAtMs - a.createdAtMs);
}

/** All the entries of one unit, newest first ("see all" under a summary row). */
export function entriesOfUnit(page: Pick<FormAnalyticsPage, "unit">, entries: readonly FormEntry[], like: Pick<FormEntry, "eventCode" | "teamNumber" | "matchKey" | "alliance">): FormEntry[] {
  const k = unitKey(page, like);
  return entries.filter((e) => unitKey(page, e) === k).sort((a, b) => b.createdAtMs - a.createdAtMs);
}

// --- the raw table's columns ---------------------------------------------------------------------------------

const EVENT_COLUMN: AnalyticsColumn = { key: "event", phase: "Information", category: "Information", label: "Event", type: "text", sortable: true, width: 110, getValue: (e) => e.eventCode };
const ALLIANCE_COLUMN: AnalyticsColumn = { key: "alliance", phase: "Information", category: "Information", label: "Alliance", type: "text", sortable: true, width: 100, getValue: (e) => (e.alliance === "red" ? "Red" : e.alliance === "blue" ? "Blue" : "") };

/**
 * The raw table for one of these forms: the schema's own columns (three-tier header), with Match and Alliance only on forms that ask for them, an Event column
 * when more than one event is shown, and Team only where the form has a team (a Lead Scout entry's teams are columns of their own). Match, Team and Scout stay sticky.
 */
export function buildFormSchema(form: Form, opts: { multiEvent: boolean; page?: Pick<FormAnalyticsPage, "hasMatch" | "hasAlliance"> }): GameSchema {
  const base = buildGameSchema(form);
  const has = (type: string) => form.sections.some((s) => s.fields.some((f) => f.type === type));
  const hasMatch = opts.page?.hasMatch ?? has("matchPicker");
  const hasAlliance = opts.page?.hasAlliance ?? has("alliancePicker");
  const hasTeam = has("teamPicker") && form.sections.some((s) => s.fields.some((f) => f.type === "teamPicker" && f.key === "teamNumber"));
  const out: AnalyticsColumn[] = [];
  for (const c of base.columns) {
    if (c.key === "match" && !hasMatch) continue;
    if (c.key === "team" && !hasTeam) continue;
    out.push(c);
    if (c.key === "match" && hasAlliance) out.push({ ...ALLIANCE_COLUMN, sticky: true, width: 90 });
  }
  if (opts.multiEvent) {
    const at = out.findIndex((c) => c.key === "scout") + 1;
    out.splice(at, 0, EVENT_COLUMN);
  }
  return { ...base, columns: out };
}
