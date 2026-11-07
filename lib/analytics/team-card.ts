import { schemaFieldMeta, type TeamStats } from "@/lib/analytics/team-stats";
import type { Form } from "@/lib/forms/types";
import { hasRole } from "@/lib/forms/meta";

// Pure helpers behind Team Breakdown's cards (P11). Like the rest of
// lib/analytics they read the form schema, never BIOBUZZ field names.

export type KeyStats = {
  /** Scored counters, summed across phases by label: "Tip Hive" = autonomous + teleop, "Pollen and Nectar" = flower + garden. Average per match. */
  counters: { label: string; avg: number }[];
  /** Scored toggles, each its own rate (0-100). A label that repeats across phases gets its phase added: "Park (auto)", "Park (endgame)". */
  rates: { label: string; rate: number }[];
};

/**
 * Bite-sized game-piece stats for a team card, derived from the schema's
 * scored fields: counters grouped by label (so a piece scored in two phases
 * or two places reads as one total), toggles as individual rates.
 */
export function buildKeyStats(stats: TeamStats, schema: Form): KeyStats {
  const meta = schemaFieldMeta(schema).filter((m) => m.points && stats.fieldStats[m.field.key]);

  const counterTotals = new Map<string, number>();
  for (const m of meta) {
    if (m.field.type !== "counter") continue;
    counterTotals.set(m.field.label, (counterTotals.get(m.field.label) ?? 0) + (stats.fieldStats[m.field.key].avg ?? 0));
  }

  const toggles = meta.filter((m) => m.field.type === "toggle");
  const labelUses = new Map<string, number>();
  for (const m of toggles) labelUses.set(m.field.label, (labelUses.get(m.field.label) ?? 0) + 1);

  return {
    counters: [...counterTotals.entries()].map(([label, avg]) => ({ label, avg })),
    rates: toggles.map((m) => ({
      label: (labelUses.get(m.field.label) ?? 0) > 1 ? `${m.field.label} (${m.phase})` : m.field.label,
      rate: stats.fieldStats[m.field.key].rate ?? 0,
    })),
  };
}

export type ReliabilityLevel = "reliable" | "some-issues" | "unreliable" | "unknown";

export const RELIABLE_AT = 90;
export const SOME_ISSUES_AT = 75;

/** The pill's level from the share of entries with no reliability incident (see `TeamStats.reliability`). */
export function reliabilityLevel(reliability: number | null): ReliabilityLevel {
  if (reliability === null) return "unknown";
  if (reliability >= RELIABLE_AT) return "reliable";
  if (reliability >= SOME_ISSUES_AT) return "some-issues";
  return "unreliable";
}

/** The reliability incidents this team actually had, worst first — what the pill's tooltip lists ("Died During Match 25%"). */
export function reliabilityIncidents(stats: TeamStats, schema: Form): { label: string; rate: number }[] {
  return schemaFieldMeta(schema)
    .filter((m) => hasRole(m.field, "reliability") && (stats.incidentRates[m.field.key] ?? 0) > 0)
    .map((m) => ({ label: m.field.label, rate: stats.incidentRates[m.field.key] }))
    .sort((a, b) => b.rate - a.rate || a.label.localeCompare(b.label));
}

export type TeamSortKey = "avgTotal" | "entryCount" | "reliability" | "teamNumber";

export const TEAM_SORTS: { id: TeamSortKey; label: string }[] = [
  { id: "avgTotal", label: "Avg. total" },
  { id: "entryCount", label: "Times scouted" },
  { id: "reliability", label: "Reliability" },
  { id: "teamNumber", label: "Team number" },
];

/** Best first (team number: lowest first); teams without a value sort last; ties fall back to team number. Never mutates the input. */
export function sortTeams(teams: TeamStats[], key: TeamSortKey): TeamStats[] {
  const value = (t: TeamStats): number | null => (key === "teamNumber" ? t.teamNumber : key === "reliability" ? t.reliability : t[key]);
  return [...teams].sort((a, b) => {
    const av = value(a);
    const bv = value(b);
    if (av === null && bv === null) return a.teamNumber - b.teamNumber;
    if (av === null) return 1;
    if (bv === null) return -1;
    const diff = key === "teamNumber" ? av - bv : bv - av;
    return diff || a.teamNumber - b.teamNumber;
  });
}

/** Team-number or name search (empty matches everything). */
export function teamMatchesSearch(team: Pick<TeamStats, "teamNumber" | "teamName">, query: string): boolean {
  const q = query.trim().toLowerCase();
  return q === "" || String(team.teamNumber).includes(q) || (team.teamName ?? "").toLowerCase().includes(q);
}
