import { rankWithTies } from "@/lib/accuracy/engine";
import { formatMatch, matchSortValue } from "@/lib/analytics/game-schema";
import type { AnalyticsEntry } from "@/lib/analytics/entries";
import type { MatchType } from "@/lib/ftc/types";
import type { ScoutFormField, ScoutFormSchema } from "@/lib/scout-form/schema";

// Pure team statistics for Team Profile, Team Averages and Rankings (P10).
// Everything is driven by the form schema (P2), never by BIOBUZZ's field
// names, so a new season's schema needs no changes here.

/** Entries a team is trending on: this many of the most recent are compared against the overall average. */
export const TREND_RECENT_COUNT = 3;
/** Teams scouted fewer than this many times are flagged "low sample". */
export const DEFAULT_MIN_ENTRIES = 2;

export type FieldStat = {
  key: string;
  label: string;
  type: "toggle" | "counter" | "checkbox";
  /** The schema section this field sits in (`autonomous`, `teleop`, ...) and its sub-group label, if any. */
  sectionId: string;
  groupLabel: string | null;
  /** Counters: mean and highest tally. Null for toggles/checkboxes. */
  avg: number | null;
  high: number | null;
  /** Toggles/checkboxes: the share of entries (0-100) where it was on. Null for counters. */
  rate: number | null;
  /** Mean points this field contributed per entry — null for fields that don't score. */
  avgPoints: number | null;
};

export type ElementStat = {
  element: string;
  /** Mean points per entry from this game element, across every phase. */
  avgPoints: number;
  /** Fraction (0-1) of the team's mean score that comes from this element. */
  share: number;
};

export type TrendDirection = "up" | "down" | "flat";
export type Trend = {
  /** Null when there aren't enough entries to compare recent against overall. */
  direction: TrendDirection | null;
  /** Recent average minus overall average (points). */
  delta: number;
  recentAvg: number | null;
  recentCount: number;
};

export type MatchScouted = {
  entryId: string;
  eventCode: string;
  matchType: MatchType;
  matchNumber: number;
  /** "Q12", "P3", "F2". */
  label: string;
  auto: number;
  teleop: number;
  endgame: number;
  total: number;
  /** Whole-alliance accuracy for this match (0-100), or null if it couldn't be computed. */
  accuracy: number | null;
  scoutName: string;
  comments: string;
  submittedAt: string;
  sessionId: string | null;
};

export type TeamStats = {
  teamNumber: number;
  teamName: string | null;
  /** "Times scouted". */
  entryCount: number;
  matchesScouted: MatchScouted[];
  avgTotal: number;
  medianTotal: number;
  highTotal: number;
  lowTotal: number;
  /** Sample standard deviation of total score (0 with a single entry). */
  stdDev: number;
  /** 0-100, higher = steadier: 100 minus the coefficient of variation (stdDev / avgTotal) as a percent, floored at 0. */
  consistency: number;
  avgAuto: number;
  avgTeleop: number;
  avgEndgame: number;
  fieldStats: Record<string, FieldStat>;
  /** Share (0-100) of entries with each General checkbox on, keyed by field key. */
  incidentRates: Record<string, number>;
  elementBreakdown: ElementStat[];
  /** Mean alliance accuracy (0-100) over the entries that have one; null if none do. */
  avgAccuracy: number | null;
  trend: Trend;
};

// --- helpers -------------------------------------------------------------

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length === 0 ? 0 : sum(xs) / xs.length);

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function sampleStdDev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}

/** 100 minus the coefficient of variation, clamped to 0-100. A steady zero-scorer reads 100; any spread around a zero mean reads 0. */
export function consistencyOf(avg: number, stdDev: number): number {
  if (avg <= 0) return stdDev === 0 ? 100 : 0;
  return Math.max(0, Math.min(100, 100 - (stdDev / avg) * 100));
}

type FieldMeta = { field: ScoutFormField; sectionId: string; groupLabel: string | null };

/** Every field in the schema with where it sits — the iteration order Team Profile renders in. */
export function schemaFieldMeta(schema: ScoutFormSchema): FieldMeta[] {
  const out: FieldMeta[] = [];
  for (const section of schema.sections) {
    for (const field of section.fields ?? []) out.push({ field, sectionId: section.id, groupLabel: null });
    for (const group of section.groups ?? []) {
      for (const field of group.fields) out.push({ field, sectionId: section.id, groupLabel: group.label });
    }
  }
  return out;
}

function rawValue(entry: AnalyticsEntry, key: string): unknown {
  return (entry.fields as unknown as Record<string, unknown>)[key];
}

function numberValue(entry: AnalyticsEntry, key: string): number {
  const v = rawValue(entry, key);
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

const elementOf = ({ field, groupLabel }: FieldMeta) => field.element ?? groupLabel ?? field.label;

// --- buildTeamStats ------------------------------------------------------

/**
 * Stats for ONE team from its entries. The caller passes only the entries a
 * page may use (already excluded/accuracy filtered — see
 * `selectAnalyticsEntries`); this function never filters. `teamNumber`
 * defaults to the first entry's, and is required to build an empty result.
 */
export function buildTeamStats(
  entries: AnalyticsEntry[],
  schema: ScoutFormSchema,
  options: { teamNumber?: number; teamName?: string | null } = {}
): TeamStats {
  const teamNumber = options.teamNumber ?? entries[0]?.teamNumber ?? 0;
  const n = entries.length;
  const totals = entries.map((e) => e.score.total);
  const avgTotal = mean(totals);
  const stdDev = sampleStdDev(totals);

  const meta = schemaFieldMeta(schema);

  const fieldStats: Record<string, FieldStat> = {};
  const incidentRates: Record<string, number> = {};
  const elementPoints = new Map<string, number>();

  for (const m of meta) {
    const { field } = m;
    if (field.type !== "toggle" && field.type !== "counter" && field.type !== "checkbox") continue;

    const base = { key: field.key, label: field.label, type: field.type, sectionId: m.sectionId, groupLabel: m.groupLabel };
    const scored = !!field.points && !!field.phase;

    if (field.type === "counter") {
      const tallies = entries.map((e) => numberValue(e, field.key));
      const avg = mean(tallies);
      fieldStats[field.key] = {
        ...base,
        avg,
        high: n === 0 ? 0 : Math.max(...tallies),
        rate: null,
        avgPoints: scored ? avg * field.points! : null,
      };
    } else {
      const on = entries.filter((e) => rawValue(e, field.key) === true).length;
      const rate = n === 0 ? 0 : (on / n) * 100;
      fieldStats[field.key] = { ...base, avg: null, high: null, rate, avgPoints: scored ? (rate / 100) * field.points! : null };
      if (field.type === "checkbox") incidentRates[field.key] = rate;
    }

    const points = fieldStats[field.key].avgPoints;
    if (points !== null) {
      const element = elementOf(m);
      elementPoints.set(element, (elementPoints.get(element) ?? 0) + points);
    }
  }

  const pointsTotal = sum([...elementPoints.values()]);
  const elementBreakdown: ElementStat[] = [...elementPoints.entries()]
    .map(([element, avgPoints]) => ({ element, avgPoints, share: pointsTotal > 0 ? avgPoints / pointsTotal : 0 }))
    .sort((a, b) => b.avgPoints - a.avgPoints || a.element.localeCompare(b.element));

  const matchesScouted: MatchScouted[] = entries
    .map((e) => ({
      entryId: e.id,
      eventCode: e.eventCode,
      matchType: e.matchType,
      matchNumber: e.matchNumber,
      label: formatMatch(e),
      auto: e.score.auto,
      teleop: e.score.teleop,
      endgame: e.score.endgame,
      total: e.score.total,
      accuracy: e.allianceAccuracy,
      scoutName: e.scoutName,
      comments: e.comments,
      submittedAt: e.submittedAt,
      sessionId: e.sessionId,
    }))
    .sort((a, b) => matchSortValue(a) - matchSortValue(b) || a.eventCode.localeCompare(b.eventCode) || a.submittedAt.localeCompare(b.submittedAt));

  const accuracies = entries.map((e) => e.allianceAccuracy).filter((a): a is number => a !== null);

  return {
    teamNumber,
    teamName: options.teamName ?? null,
    entryCount: n,
    matchesScouted,
    avgTotal,
    medianTotal: median(totals),
    highTotal: n === 0 ? 0 : Math.max(...totals),
    lowTotal: n === 0 ? 0 : Math.min(...totals),
    stdDev,
    consistency: consistencyOf(avgTotal, stdDev),
    avgAuto: mean(entries.map((e) => e.score.auto)),
    avgTeleop: mean(entries.map((e) => e.score.teleop)),
    avgEndgame: mean(entries.map((e) => e.score.endgame)),
    fieldStats,
    incidentRates,
    elementBreakdown,
    avgAccuracy: accuracies.length === 0 ? null : mean(accuracies),
    trend: computeTrend(entries, avgTotal),
  };
}

/** Recent entries (by submission time) against the overall average; needs at least one entry older than the recent window to mean anything. */
function computeTrend(entries: AnalyticsEntry[], overallAvg: number): Trend {
  if (entries.length <= TREND_RECENT_COUNT) return { direction: null, delta: 0, recentAvg: null, recentCount: 0 };
  const recent = [...entries].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)).slice(-TREND_RECENT_COUNT);
  const recentAvg = mean(recent.map((e) => e.score.total));
  const delta = recentAvg - overallAvg;
  // Within 5% of the overall average (and at least a point) is noise, not a trend.
  const threshold = Math.max(1, Math.abs(overallAvg) * 0.05);
  const direction: TrendDirection = delta > threshold ? "up" : delta < -threshold ? "down" : "flat";
  return { direction, delta, recentAvg, recentCount: recent.length };
}

/** One `TeamStats` per team in `entries`, ordered by team number. `teamNames` fills in `teamName`. */
export function buildAllTeamStats(entries: AnalyticsEntry[], schema: ScoutFormSchema, teamNames: ReadonlyMap<number, string> = new Map()): TeamStats[] {
  const byTeam = new Map<number, AnalyticsEntry[]>();
  for (const e of entries) {
    const list = byTeam.get(e.teamNumber);
    if (list) list.push(e);
    else byTeam.set(e.teamNumber, [e]);
  }
  return [...byTeam.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([teamNumber, list]) => buildTeamStats(list, schema, { teamNumber, teamName: teamNames.get(teamNumber) ?? null }));
}

// --- ranking -------------------------------------------------------------

export type RankMetric = "avgTotal" | "avgAuto" | "avgTeleop" | "avgEndgame" | "highTotal" | "consistency";

export const RANK_METRICS: { id: RankMetric; label: string }[] = [
  { id: "avgTotal", label: "Avg. total" },
  { id: "avgAuto", label: "Avg. auto" },
  { id: "avgTeleop", label: "Avg. teleop" },
  { id: "avgEndgame", label: "Avg. endgame" },
  { id: "highTotal", label: "High score" },
  { id: "consistency", label: "Consistency" },
];

export function metricValue(stats: TeamStats, metric: RankMetric): number {
  return stats[metric];
}

/** True when a team has been scouted fewer than `minEntries` times. */
export function lowSample(stats: Pick<TeamStats, "entryCount">, minEntries: number = DEFAULT_MIN_ENTRIES): boolean {
  return stats.entryCount < minEntries;
}

export type RankedTeam = {
  stats: TeamStats;
  /** 1, 2, 2, 4 (ties share a rank). Null for low-sample teams — they're listed but not ranked. */
  rank: number | null;
  value: number;
  lowSample: boolean;
};

/**
 * Ranks teams by `metric` (higher is better) with `rankWithTies`. Teams below
 * `minEntries` are still returned — flagged, unranked, and sorted after every
 * ranked team (best value first) — so a lucky one-match team can't top the
 * list. Tied teams are ordered by team number so the order is deterministic.
 */
export function rankTeams(teamStats: TeamStats[], metric: RankMetric, minEntries: number = DEFAULT_MIN_ENTRIES): RankedTeam[] {
  // Rank on 2-decimal values so float noise in a sum can't split a genuine tie.
  const value = (s: TeamStats) => Math.round(metricValue(s, metric) * 100) / 100;
  const ordered = [...teamStats].sort((a, b) => value(b) - value(a) || a.teamNumber - b.teamNumber);

  return rankWithTies(ordered, (s) => (lowSample(s, minEntries) ? null : value(s))).map(({ item, rank }) => ({
    stats: item,
    rank,
    value: metricValue(item, metric),
    lowSample: lowSample(item, minEntries),
  }));
}
