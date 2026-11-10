import type { AnalyticsEntry } from "@/lib/analytics/entries";
import type { OfficialMatch } from "@/lib/analytics/match-breakdown";
import type { MatchType } from "@/lib/ftc/types";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import { CATEGORY_IDS, classifyMatch, finalsMatchNumbers, statusMatchLabel, type StatusCategory } from "@/lib/scout-status/categories";
import { SCOUT_STATUS_CONFIG } from "@/lib/scout-status/config";
import { inRanges, parseRangeText, rangeNumbers, type ParsedRanges } from "@/lib/scout-status/ranges";

// The Scout Status model (P16): which matches count, the targets, per-scout progress,
// and per-robot coverage. Pure — the page feeds it the shared Analytics entries (already
// filtered by Game / Event / Practice / Accuracy), the official schedule, Assignments,
// attendance and the saved setup, and renders what comes back.

export type CategoryRecord<T> = Record<StatusCategory, T>;
const perCategory = <T>(make: (c: StatusCategory) => T): CategoryRecord<T> => Object.fromEntries(CATEGORY_IDS.map((c) => [c, make(c)])) as CategoryRecord<T>;

/** The saved setup for one event (`scoutTargets/{teamId}_{eventCode}`). */
export type EventSetup = {
  /** Range text per category; blank/absent = every match in it. */
  ranges: Partial<Record<StatusCategory, string>>;
  /** Max-match overrides ("manual"); absent = take it from the schedule. */
  maxOverrides: Partial<Record<StatusCategory, number>>;
  /** Manual per-scout targets, by uid, by category. */
  individual: Record<string, Partial<Record<StatusCategory, number>>>;
  /** Members added by hand to the targets table. */
  extraScouts: string[];
  /** P30: teams-per-scout targets for the team-based forms (Pit Scout, Team Strategy), by form type: one number for everyone and/or per scout. */
  teamTargets?: Partial<Record<"pit-scout" | "team-strategy", { all?: number | null; individual?: Record<string, number> }>>;
};

export const EMPTY_SETUP: EventSetup = { ranges: {}, maxOverrides: {}, individual: {}, extraScouts: [] };

export const matchKeyOf = (eventCode: string, matchType: MatchType, matchNumber: number): string => `${eventCode}|${matchType}|${matchNumber}`;

export type StatusMatch = {
  key: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  category: StatusCategory;
  /** "P12", "Q12", "SF5", "F14". */
  label: string;
  played: boolean;
  red: number[];
  blue: number[];
};

/** One event, with its matches classified and its ranges/enabled categories applied. */
export type EventContext = {
  eventCode: string;
  /** In range and in an enabled category, sorted by category then number. */
  matches: StatusMatch[];
  /** Every official match of the event, classified (range and category filter NOT applied) — for deciding what an entry's match is. */
  categoryOf: (matchType: MatchType, matchNumber: number) => StatusCategory;
  /** Does this match count under the category filter and ranges? */
  includes: (matchType: MatchType, matchNumber: number) => boolean;
  /** The FIRST API (or library) gave us this event's schedule. Without one, max targets are manual. */
  hasSchedule: boolean;
  parsedRanges: CategoryRecord<ParsedRanges>;
};

const categoryOrder = (c: StatusCategory) => CATEGORY_IDS.indexOf(c);

export function buildEventContext(input: { eventCode: string; matches: OfficialMatch[]; setup: EventSetup; enabled: ReadonlySet<StatusCategory>; hasSchedule?: boolean }): EventContext {
  const { eventCode, matches, setup, enabled } = input;
  const parsedRanges = perCategory((c) => parseRangeText(setup.ranges[c] ?? ""));
  // A typed Finals range names the finals matches, overriding detection when the API data is ambiguous.
  const finalsOverride = rangeNumbers(parsedRanges.final, SCOUT_STATUS_CONFIG.MAX_FINALS_OVERRIDE);
  const finals = finalsMatchNumbers(matches, finalsOverride);

  const categoryOf = (matchType: MatchType, matchNumber: number): StatusCategory => classifyMatch({ matchType, matchNumber }, matches, finalsOverride, finals);
  const includes = (matchType: MatchType, matchNumber: number): boolean => {
    const c = categoryOf(matchType, matchNumber);
    return enabled.has(c) && inRanges(parsedRanges[c], matchNumber);
  };

  const statusMatches: StatusMatch[] = matches
    .filter((m) => includes(m.matchType, m.matchNumber))
    .map((m) => {
      const category = categoryOf(m.matchType, m.matchNumber);
      return {
        key: matchKeyOf(eventCode, m.matchType, m.matchNumber),
        eventCode,
        matchType: m.matchType,
        matchNumber: m.matchNumber,
        category,
        label: statusMatchLabel(category, m.matchNumber),
        played: m.played,
        red: m.red.teams,
        blue: m.blue.teams,
      };
    })
    .sort((a, b) => categoryOrder(a.category) - categoryOrder(b.category) || a.matchNumber - b.matchNumber);

  return { eventCode, matches: statusMatches, categoryOf, includes, hasSchedule: input.hasSchedule ?? matches.length > 0, parsedRanges };
}

// --- max targets ----------------------------------------------------------------------

/** `value` is null only for a manual max nobody has entered yet (no schedule to read it from). */
export type MaxTarget = { value: number | null; source: "api" | "manual" };

/**
 * The most matches any scout could scout in each category: the number of matches in the
 * category within its range, from the schedule — or a manual number when there's no
 * schedule (e.g. a manual library event) or an admin overrode it. Disabled categories are 0.
 */
export function maxTargets(ctx: EventContext, setup: EventSetup, enabled: ReadonlySet<StatusCategory>): CategoryRecord<MaxTarget> {
  return perCategory((c) => {
    if (!enabled.has(c)) return { value: 0, source: "api" as const };
    const override = setup.maxOverrides[c];
    if (typeof override === "number") return { value: clampTarget(override), source: "manual" as const };
    if (ctx.hasSchedule) return { value: ctx.matches.filter((m) => m.category === c).length, source: "api" as const };
    return { value: null, source: "manual" as const };
  });
}

/** The ceiling a typed target is clamped to: the category's max, or the global cap while the max is still unknown. */
export const targetCap = (max: MaxTarget): number => max.value ?? SCOUT_STATUS_CONFIG.MAX_TARGET;

export const clampTarget = (n: number, max: number = SCOUT_STATUS_CONFIG.MAX_TARGET): number => (Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0);

// --- individual targets ------------------------------------------------------------------

export type AssignedSummary = {
  /** Distinct assigned matches per scout per category (within the ranges). */
  counts: Map<string, CategoryRecord<number>>;
  /** Every assigned slot: `${matchKey}|${teamNumber}` per scout, for "missing assigned". */
  slots: Map<string, Set<string>>;
  hasSchedule: boolean;
};

/** What Assignments says each scout is assigned, restricted to the matches this page counts. */
export function summarizeAssignments(ctx: EventContext, slots: ScheduleSlot[] | null | undefined): AssignedSummary {
  const counts = new Map<string, CategoryRecord<number>>();
  const keys = new Map<string, Set<string>>();
  const slotKeys = new Map<string, Set<string>>();
  for (const s of slots ?? []) {
    if (!s.scoutUid || !ctx.includes(s.matchType, s.matchNumber)) continue;
    const matchKey = matchKeyOf(ctx.eventCode, s.matchType, s.matchNumber);
    const seen = keys.get(s.scoutUid) ?? new Set<string>();
    if (!seen.has(matchKey)) {
      seen.add(matchKey);
      const row = counts.get(s.scoutUid) ?? perCategory(() => 0);
      row[ctx.categoryOf(s.matchType, s.matchNumber)] += 1;
      counts.set(s.scoutUid, row);
    }
    keys.set(s.scoutUid, seen);
    const slotSet = slotKeys.get(s.scoutUid) ?? new Set<string>();
    slotSet.add(`${matchKey}|${s.teamNumber}`);
    slotKeys.set(s.scoutUid, slotSet);
  }
  return { counts, slots: slotKeys, hasSchedule: (slots?.length ?? 0) > 0 };
}

export type TargetCell = { value: number | null; source: "assignments" | "manual" | "none" };

/**
 * One scout's target per category for one event: their manual number if set, else what
 * Assignments gives them (when a schedule is published), else blank. Always clamped to
 * 0..the category's max, and 0 for a disabled category.
 */
export function individualTargets(uid: string, setup: EventSetup, assigned: AssignedSummary, maxes: CategoryRecord<MaxTarget>, enabled: ReadonlySet<StatusCategory>): CategoryRecord<TargetCell> {
  return perCategory((c) => {
    if (!enabled.has(c)) return { value: 0, source: "none" as const };
    const manual = setup.individual[uid]?.[c];
    if (typeof manual === "number") return { value: Math.min(clampTarget(manual), targetCap(maxes[c])), source: "manual" as const };
    if (assigned.hasSchedule) return { value: Math.min(assigned.counts.get(uid)?.[c] ?? 0, targetCap(maxes[c])), source: "assignments" as const };
    return { value: null, source: "none" as const };
  });
}

// --- scout status ----------------------------------------------------------------------------

export type ScoutStatusPill = "complete" | "not-started" | "on-track" | "behind" | "no-target";

/**
 * Complete = entries ≥ target; Not started = 0 entries; otherwise On track vs Behind by comparing
 * the scout's progress with how much of the schedule has been played (`playedFraction`, 0-1, null
 * when unknown — treated as On track). With no target at all there's nothing to measure against.
 */
export function scoutStatusPill(input: { entries: number; target: number | null; playedFraction: number | null }): ScoutStatusPill {
  const { entries, target, playedFraction } = input;
  if (entries === 0) return "not-started";
  if (target === null || target <= 0) return "no-target";
  if (entries >= target) return "complete";
  if (playedFraction === null) return "on-track";
  return entries / target >= playedFraction * SCOUT_STATUS_CONFIG.ON_TRACK_FACTOR ? "on-track" : "behind";
}

export type ScoutDescriptor = { uid: string; name: string; role: string | null; inTargets: boolean };

export type ScoutRow = {
  uid: string;
  name: string;
  role: string | null;
  /** False for a scout who has entries but isn't in the targets list. */
  inTargets: boolean;
  matchesScouted: number;
  entries: number;
  byCategory: CategoryRecord<{ entries: number; target: number | null }>;
  /** Sum of the category targets; null when none is set. */
  target: number | null;
  lastEntry: { atMs: number; label: string; eventCode: string } | null;
  avgAccuracy: number | null;
  flagged: number;
  /** Assigned robots with no entry from that scout; null when there's no published schedule. */
  missingAssigned: number | null;
  status: ScoutStatusPill;
};

const entryFlagged = (e: AnalyticsEntry): boolean => e.autoFlags.some((f) => !f.dismissed) || e.manualFlags.length > 0;

const addTargets = (a: number | null, b: number | null): number | null => (a === null && b === null ? null : (a ?? 0) + (b ?? 0));

export function buildScoutRows(input: {
  scouts: ScoutDescriptor[];
  /** Entries after the shared filters (Game, Event, Practice, Accuracy; excluded dropped). */
  entries: AnalyticsEntry[];
  events: EventContext[];
  /** Per scout, per category, summed across events. */
  targets: Map<string, CategoryRecord<number | null>>;
  /** Per scout: `${matchKey}|${teamNumber}` of every assigned slot, across events. */
  assignedSlots: Map<string, Set<string>>;
  hasAssignments: boolean;
  playedFraction: number | null;
  /** Resolve a uid nobody listed (an entry from someone not in the targets table). */
  nameFor?: (uid: string, fallback: string) => string;
}): ScoutRow[] {
  const eventsByCode = new Map(input.events.map((e) => [e.eventCode, e]));
  const multiEvent = input.events.length > 1;

  // Entries that count: their match is in range and in an enabled category.
  type Counted = { entry: AnalyticsEntry; category: StatusCategory; matchKey: string };
  const counted: Counted[] = [];
  for (const entry of input.entries) {
    const ctx = eventsByCode.get(entry.eventCode);
    if (!ctx || !ctx.includes(entry.matchType, entry.matchNumber)) continue;
    counted.push({ entry, category: ctx.categoryOf(entry.matchType, entry.matchNumber), matchKey: matchKeyOf(entry.eventCode, entry.matchType, entry.matchNumber) });
  }
  const byUid = new Map<string, Counted[]>();
  for (const c of counted) byUid.set(c.entry.uid, [...(byUid.get(c.entry.uid) ?? []), c]);

  const scouts = [...input.scouts];
  const known = new Set(scouts.map((s) => s.uid));
  for (const [uid, list] of byUid) {
    if (!known.has(uid)) scouts.push({ uid, name: input.nameFor?.(uid, list[0].entry.scoutName) ?? list[0].entry.scoutName, role: null, inTargets: false });
  }

  return scouts.map((scout) => {
    const mine = byUid.get(scout.uid) ?? [];
    const target = input.targets.get(scout.uid) ?? perCategory(() => null);
    const byCategory = perCategory((c) => ({ entries: mine.filter((m) => m.category === c).length, target: target[c] }));
    const totalTarget = CATEGORY_IDS.reduce<number | null>((sum, c) => addTargets(sum, target[c]), null);

    const scoredAccuracies = mine.map((m) => m.entry.allianceAccuracy).filter((a): a is number => a !== null);
    const last = mine.reduce<Counted | null>((best, m) => (best === null || m.entry.submittedAt > best.entry.submittedAt ? m : best), null);
    const scoutedSlots = new Set(mine.map((m) => `${m.matchKey}|${m.entry.teamNumber}`));
    const assigned = input.assignedSlots.get(scout.uid);

    return {
      uid: scout.uid,
      name: scout.name,
      role: scout.role,
      inTargets: scout.inTargets,
      matchesScouted: new Set(mine.map((m) => m.matchKey)).size,
      entries: mine.length,
      byCategory,
      target: totalTarget,
      lastEntry: last ? { atMs: Date.parse(last.entry.submittedAt) || 0, label: `${statusMatchLabel(last.category, last.entry.matchNumber)}${multiEvent ? ` · ${last.entry.eventCode}` : ""}`, eventCode: last.entry.eventCode } : null,
      avgAccuracy: scoredAccuracies.length > 0 ? scoredAccuracies.reduce((a, b) => a + b, 0) / scoredAccuracies.length : null,
      flagged: mine.filter((m) => entryFlagged(m.entry)).length,
      missingAssigned: input.hasAssignments ? [...(assigned ?? [])].filter((slot) => !scoutedSlots.has(slot)).length : null,
      status: scoutStatusPill({ entries: mine.length, target: totalTarget, playedFraction: input.playedFraction }),
    };
  });
}

/** Totals across the table's rows. */
export function totalsRow(rows: ScoutRow[]): { matchesScouted: number; entries: number; target: number | null; flagged: number; avgAccuracy: number | null } {
  const accuracies = rows.map((r) => r.avgAccuracy).filter((a): a is number => a !== null);
  return {
    matchesScouted: rows.reduce((s, r) => s + r.matchesScouted, 0),
    entries: rows.reduce((s, r) => s + r.entries, 0),
    target: rows.reduce<number | null>((s, r) => addTargets(s, r.target), null),
    flagged: rows.reduce((s, r) => s + r.flagged, 0),
    avgAccuracy: accuracies.length > 0 ? accuracies.reduce((a, b) => a + b, 0) / accuracies.length : null,
  };
}

/** How much of the schedule (matches this page counts) has been played, 0-1; null when there is no schedule to tell. */
export function playedFractionOf(events: EventContext[]): number | null {
  const all = events.filter((e) => e.hasSchedule).flatMap((e) => e.matches);
  if (all.length === 0) return null;
  return all.filter((m) => m.played).length / all.length;
}

// --- coverage --------------------------------------------------------------------------------

export type RobotCoverage = { teamNumber: number; alliance: "red" | "blue"; scouts: { uid: string; name: string }[] };

export type MatchCoverage = {
  match: StatusMatch;
  robots: RobotCoverage[];
  /** Robots with at least one scout. */
  scoutedCount: number;
  /** Played matches show a red X for an unscouted robot; an upcoming match stays neutral until it is played. */
  state: "played" | "upcoming";
};

/**
 * One entry per match the page counts: each robot grouped by alliance with the scouts
 * who scouted it (two scouts on one robot = two checks). Uses the same filtered entries
 * as the table, so the accuracy filter and exclusions apply to the ticks too.
 */
export function buildCoverage(input: { events: EventContext[]; entries: AnalyticsEntry[]; practiceDataset: boolean }): MatchCoverage[] {
  const scoutsBySlot = new Map<string, Map<string, string>>();
  for (const entry of input.entries) {
    const key = `${matchKeyOf(entry.eventCode, entry.matchType, entry.matchNumber)}|${entry.teamNumber}`;
    const names = scoutsBySlot.get(key) ?? new Map<string, string>();
    names.set(entry.uid, entry.scoutName);
    scoutsBySlot.set(key, names);
  }
  return input.events.flatMap((ctx) =>
    ctx.matches.map((match) => {
      const robot = (teamNumber: number, alliance: "red" | "blue"): RobotCoverage => ({
        teamNumber,
        alliance,
        scouts: [...(scoutsBySlot.get(`${match.key}|${teamNumber}`) ?? new Map<string, string>()).entries()].map(([uid, name]) => ({ uid, name })),
      });
      const robots = [...match.red.map((t) => robot(t, "red")), ...match.blue.map((t) => robot(t, "blue"))];
      return { match, robots, scoutedCount: robots.filter((r) => r.scouts.length > 0).length, state: input.practiceDataset || match.played ? ("played" as const) : ("upcoming" as const) };
    })
  );
}

// --- targets across events, and who is in the table -------------------------------------------------

/**
 * Sums each scout's per-category target across events (a blank in one event counts as 0 as long as
 * another event has a number; blank in all of them stays blank).
 */
export function sumTargets(perEvent: Array<Map<string, CategoryRecord<TargetCell>>>): Map<string, CategoryRecord<number | null>> {
  const out = new Map<string, CategoryRecord<number | null>>();
  for (const eventTargets of perEvent) {
    for (const [uid, cells] of eventTargets) {
      const row = out.get(uid) ?? perCategory<number | null>(() => null);
      for (const c of CATEGORY_IDS) row[c] = addTargets(row[c], cells[c].value);
      out.set(uid, row);
    }
  }
  return out;
}

type MemberLike = { uid: string; name: string; primaryRole: string; secondaryRoles: string[] };

/**
 * The rows of the individual-targets table: every member whose primary or secondary role is
 * Match Scout and who is marked as attending (Assignments attendance) — plus anyone added by hand.
 */
export function targetScouts(input: { members: MemberLike[]; attendingUids: ReadonlySet<string>; extraUids: ReadonlySet<string>; roleLabel: (primaryRole: string) => string }): ScoutDescriptor[] {
  const isMatchScout = (m: MemberLike) => m.primaryRole === "match-scout" || m.secondaryRoles.includes("match-scout");
  return input.members
    .filter((m) => (isMatchScout(m) && input.attendingUids.has(m.uid)) || input.extraUids.has(m.uid))
    .map((m) => ({ uid: m.uid, name: m.name, role: input.roleLabel(m.primaryRole), inTargets: true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
