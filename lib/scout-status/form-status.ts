import type { FormEntry } from "@/lib/form-entries-model";
import { formMatchKey } from "@/lib/form-entries-model";
import { CATEGORY_IDS, type StatusCategory } from "@/lib/scout-status/categories";
import { clampTarget, scoutStatusPill, type CategoryRecord, type EventContext, type ScoutDescriptor, type ScoutStatusPill } from "@/lib/scout-status/compute";
import type { ImageValue } from "@/lib/forms/types";

// P30: Scout Status for the other form types. Pure: the page feeds it the event contexts (matches in range), the team list, the form entries, the saved targets and
// (P31) what Assignments gives each scout. Three kinds of unit: an alliance in a match (Lead Scout, Match Strategy, Drive Reflection), a team (Pit Scout, Team
// Strategy), and a plain count (Helper). Accuracy doesn't apply to any of them.

const live = (entries: readonly FormEntry[], formType: FormEntry["formType"], eventCodes: ReadonlySet<string>) => entries.filter((e) => e.formType === formType && !e.excluded && eventCodes.has(e.eventCode));

// --- alliance units ---------------------------------------------------------------------------------------------

export type AllianceUnit = { key: string; eventCode: string; matchKey: string; label: string; alliance: "red" | "blue"; category: StatusCategory; teams: number[]; played: boolean };

/** The checkable alliances: Red and Blue of every match in range (the ranges and category filter apply, as on the Match Scout table). */
export function allianceUnits(events: readonly EventContext[]): AllianceUnit[] {
  const out: AllianceUnit[] = [];
  for (const ev of events) {
    for (const m of ev.matches) {
      const matchKey = formMatchKey(m.matchType, m.matchNumber);
      for (const alliance of ["red", "blue"] as const) {
        out.push({ key: `${ev.eventCode}|${matchKey}|${alliance}`, eventCode: ev.eventCode, matchKey, label: m.label, alliance, category: m.category, teams: alliance === "red" ? m.red : m.blue, played: m.played });
      }
    }
  }
  return out;
}

const unitKeyOf = (e: Pick<FormEntry, "eventCode" | "matchKey" | "alliance">) => `${e.eventCode}|${e.matchKey ?? ""}|${e.alliance ?? ""}`;

export type AllianceCoverage = {
  unit: AllianceUnit;
  /** The entries for this alliance (any number of scouts can do one). */
  entries: FormEntry[];
  scouts: string[];
  done: boolean;
  /** Drive Reflection: a plan exists for this alliance. */
  planned: boolean;
  /** Drive Reflection: planned but nobody has reflected on it yet. */
  planWithoutReflection: boolean;
  /** Drive Reflection: the most differences from the plan any reflection reports (0 with none). */
  differences: number;
};

/** For each alliance: who scouted it, and (for a Drive Reflection) whether a plan exists and how far reality drifted from it. `plans` are the Match Strategy entries. */
export function allianceCoverage(units: readonly AllianceUnit[], entries: readonly FormEntry[], plans: readonly FormEntry[] = []): AllianceCoverage[] {
  const byUnit = new Map<string, FormEntry[]>();
  for (const e of entries) byUnit.set(unitKeyOf(e), [...(byUnit.get(unitKeyOf(e)) ?? []), e]);
  const planned = new Set(plans.filter((p) => !p.excluded).map(unitKeyOf));
  return units.map((unit) => {
    const mine = byUnit.get(unit.key) ?? [];
    const isPlanned = planned.has(unit.key);
    return {
      unit,
      entries: mine,
      scouts: [...new Set(mine.map((e) => e.uid))],
      done: mine.length > 0,
      planned: isPlanned,
      planWithoutReflection: isPlanned && mine.length === 0,
      differences: mine.reduce((max, e) => Math.max(max, e.planDifferences ?? 0), 0),
    };
  });
}

export type AllianceScoutRow = {
  uid: string;
  name: string;
  role: string | null;
  inTargets: boolean;
  /** Distinct alliances scouted. */
  alliances: number;
  entries: number;
  byCategory: CategoryRecord<{ entries: number; target: number | null }>;
  target: number | null;
  lastEntry: { atMs: number; label: string; eventCode: string } | null;
  status: ScoutStatusPill;
};

const emptyCategories = (): CategoryRecord<{ entries: number; target: number | null }> => Object.fromEntries(CATEGORY_IDS.map((c) => [c, { entries: 0, target: null }])) as CategoryRecord<{ entries: number; target: number | null }>;

/** One row per scout: alliances scouted per category against the same per-category targets as the Match Scout table (an alliance counts where a robot did there). */
export function allianceScoutRows(input: { scouts: readonly ScoutDescriptor[]; entries: readonly FormEntry[]; units: readonly AllianceUnit[]; targets: ReadonlyMap<string, CategoryRecord<number | null>>; playedFraction: number | null; nameFor: (uid: string, fallback: string) => string }): AllianceScoutRow[] {
  const unitByKey = new Map(input.units.map((u) => [u.key, u]));
  const descriptors = new Map(input.scouts.map((s) => [s.uid, s]));
  for (const e of input.entries) if (!descriptors.has(e.uid)) descriptors.set(e.uid, { uid: e.uid, name: e.scoutName, role: null, inTargets: false });
  return [...descriptors.values()]
    .map((s): AllianceScoutRow => {
      const mine = input.entries.filter((e) => e.uid === s.uid && unitByKey.has(unitKeyOf(e)));
      const seen = new Set<string>();
      const byCategory = emptyCategories();
      let last: AllianceScoutRow["lastEntry"] = null;
      for (const e of mine) {
        const k = unitKeyOf(e);
        const unit = unitByKey.get(k)!;
        if (!seen.has(k)) {
          seen.add(k);
          byCategory[unit.category].entries += 1;
        }
        if (!last || e.createdAtMs > last.atMs) last = { atMs: e.createdAtMs, label: unit.label, eventCode: e.eventCode };
      }
      const t = input.targets.get(s.uid);
      let target: number | null = null;
      for (const c of CATEGORY_IDS) {
        const v = t?.[c] ?? null;
        byCategory[c].target = v;
        if (v !== null) target = (target ?? 0) + v;
      }
      return { uid: s.uid, name: input.nameFor(s.uid, s.name), role: s.role, inTargets: s.inTargets, alliances: seen.size, entries: mine.length, byCategory, target, lastEntry: last, status: scoutStatusPill({ entries: seen.size, target, playedFraction: input.playedFraction }) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- team units ---------------------------------------------------------------------------------------------------

export type TeamCoverageRow = { teamNumber: number; name: string | null; entries: FormEntry[]; scouts: string[]; done: boolean; photoUrl: string | null };

/** The checkable teams: the event's teams, without our own FTC teams unless `includeOurs`. */
export function checkableTeams(teams: readonly number[], isOurs: (team: number) => boolean, includeOurs: boolean): number[] {
  return [...new Set(teams)].filter((t) => includeOurs || !isOurs(t)).sort((a, b) => a - b);
}

/** For each team: who did it (Pit Scout rows also carry the latest photo for the grid's thumbnail). */
export function teamCoverage(teams: readonly number[], entries: readonly FormEntry[], names: ReadonlyMap<number, string> = new Map()): TeamCoverageRow[] {
  const byTeam = new Map<number, FormEntry[]>();
  for (const e of entries) if (typeof e.teamNumber === "number") byTeam.set(e.teamNumber, [...(byTeam.get(e.teamNumber) ?? []), e]);
  return teams.map((teamNumber) => {
    const mine = (byTeam.get(teamNumber) ?? []).slice().sort((a, b) => b.createdAtMs - a.createdAtMs);
    const photo = mine.map((e) => (Array.isArray(e.values.photos) ? (e.values.photos as ImageValue[])[0] : undefined)).find((p) => !!p?.url);
    return { teamNumber, name: names.get(teamNumber) ?? null, entries: mine, scouts: [...new Set(mine.map((e) => e.uid))], done: mine.length > 0, photoUrl: photo?.url ?? null };
  });
}

/** The saved teams-per-scout setup for one form type at one event (inside `scoutTargets.teamTargets`). */
export type TeamTargetSetup = { all?: number | null; individual?: Record<string, number> };

export type TeamTarget = { value: number | null; source: "manual" | "assignments" | "all" | "none" };

/**
 * A scout's teams-to-scout target: their own manual number, else the single "everyone" number, else what Assignments gives them (P31), else none. The manual numbers
 * win over Assignments, so a lead can override one person without touching the rest.
 */
export function resolveTeamTarget(uid: string, setup: TeamTargetSetup | undefined, assignedCount: number | null | undefined): TeamTarget {
  const own = setup?.individual?.[uid];
  if (typeof own === "number") return { value: clampTarget(own), source: "manual" };
  if (typeof assignedCount === "number") return { value: clampTarget(assignedCount), source: "assignments" };
  if (typeof setup?.all === "number") return { value: clampTarget(setup.all), source: "all" };
  return { value: null, source: "none" };
}

export type TeamScoutRow = {
  uid: string;
  name: string;
  role: string | null;
  inTargets: boolean;
  /** Distinct teams done. */
  teams: number;
  entries: number;
  target: TeamTarget;
  lastEntryAtMs: number | null;
  status: ScoutStatusPill;
};

export function teamScoutRows(input: { scouts: readonly ScoutDescriptor[]; entries: readonly FormEntry[]; setupFor: (eventCode: string) => TeamTargetSetup | undefined; eventCodes: readonly string[]; assignedCounts: ReadonlyMap<string, number> | null; nameFor: (uid: string, fallback: string) => string }): TeamScoutRow[] {
  const descriptors = new Map(input.scouts.map((s) => [s.uid, s]));
  for (const e of input.entries) if (!descriptors.has(e.uid)) descriptors.set(e.uid, { uid: e.uid, name: e.scoutName, role: null, inTargets: false });
  return [...descriptors.values()]
    .map((s): TeamScoutRow => {
      const mine = input.entries.filter((e) => e.uid === s.uid && typeof e.teamNumber === "number");
      const distinct = new Set(mine.map((e) => `${e.eventCode}|${e.teamNumber}`));
      // several events add up: each event's target for this scout, summed
      let total: number | null = null;
      let source: TeamTarget["source"] = "none";
      for (const code of input.eventCodes) {
        const t = resolveTeamTarget(s.uid, input.setupFor(code), input.assignedCounts?.get(s.uid) ?? null);
        if (t.value !== null) {
          total = (total ?? 0) + t.value;
          source = source === "none" || source === t.source ? t.source : "manual";
        }
      }
      const target: TeamTarget = { value: total, source };
      return { uid: s.uid, name: input.nameFor(s.uid, s.name), role: s.role, inTargets: s.inTargets, teams: distinct.size, entries: mine.length, target, lastEntryAtMs: mine.reduce<number | null>((m, e) => (m === null || e.createdAtMs > m ? e.createdAtMs : m), null), status: scoutStatusPill({ entries: distinct.size, target: target.value, playedFraction: null }) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

// --- Helper (a count) ----------------------------------------------------------------------------------------------

export type HelperCountRow = { uid: string; name: string; role: string | null; assists: number; successful: number; lastEntryAtMs: number | null };

export function helperCountRows(input: { scouts: readonly ScoutDescriptor[]; entries: readonly FormEntry[]; nameFor: (uid: string, fallback: string) => string }): HelperCountRow[] {
  const descriptors = new Map(input.scouts.map((s) => [s.uid, s]));
  for (const e of input.entries) if (!descriptors.has(e.uid)) descriptors.set(e.uid, { uid: e.uid, name: e.scoutName, role: null, inTargets: false });
  return [...descriptors.values()]
    .map((s): HelperCountRow => {
      const mine = input.entries.filter((e) => e.uid === s.uid);
      return { uid: s.uid, name: input.nameFor(s.uid, s.name), role: s.role, assists: mine.length, successful: mine.filter((e) => e.values.successful === "yes").length, lastEntryAtMs: mine.reduce<number | null>((m, e) => (m === null || e.createdAtMs > m ? e.createdAtMs : m), null) };
    })
    .sort((a, b) => b.assists - a.assists || a.name.localeCompare(b.name));
}

// --- which scouts are listed ---------------------------------------------------------------------------------------

/** Who gets a row: attending members who can open the form's page, plus anyone added by hand. (Anyone with an entry is added by the row builders.) */
export function eligibleFormScouts(input: { members: readonly { uid: string; name: string; primaryRole: string }[]; attendingUids: ReadonlySet<string>; extraUids: ReadonlySet<string>; canAccess: (uid: string) => boolean; roleLabel: (primaryRole: string) => string }): ScoutDescriptor[] {
  return input.members
    .filter((m) => (input.attendingUids.has(m.uid) && input.canAccess(m.uid)) || input.extraUids.has(m.uid))
    .map((m) => ({ uid: m.uid, name: m.name, role: input.roleLabel(m.primaryRole), inTargets: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The entries of one form type in the events in play (excluded entries never count). */
export function statusEntries(entries: readonly FormEntry[], formType: FormEntry["formType"], eventCodes: readonly string[]): FormEntry[] {
  return live(entries, formType, new Set(eventCodes));
}
