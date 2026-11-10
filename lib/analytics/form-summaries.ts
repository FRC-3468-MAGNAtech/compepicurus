import type { FormEntry } from "@/lib/form-entries-model";
import { latestPerUnit, type FormAnalyticsPage } from "@/lib/analytics/form-analytics";
import { slotKey } from "@/lib/forms/repeat";
import type { FormValue, ImageValue } from "@/lib/forms/types";
import { weightInPounds } from "@/lib/forms/pit-suggest";

// P30: the summary view of each new form's data: what the raw table says, boiled down per team or per match. Pure; everything here reads stored `values` by key, so
// a renamed field needs a keyAliases entry, like the rest of the app.

const MAX_SLOTS = 4;
const num = (v: FormValue | undefined): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: FormValue | undefined): string => (typeof v === "string" ? v : "");
const avg = (xs: number[]): number | null => (xs.length === 0 ? null : Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 100) / 100);

/** The teams of a per-team group in an entry: `[{slot, team}]` for each slot that names a team. */
export function slotTeams(values: FormEntry["values"]): { slot: number; team: number }[] {
  const out: { slot: number; team: number }[] = [];
  for (let slot = 1; slot <= MAX_SLOTS; slot++) {
    const t = num(values[slotKey(slot, "team")]);
    if (t !== null && t > 0) out.push({ slot, team: t });
  }
  return out;
}

// --- Lead Scout -----------------------------------------------------------------------------------------------

export type LeadTeamRow = { teamNumber: number; averageSkill: number | null; entries: number; notes: { text: string; scoutName: string; matchKey: string | null }[] };
export type LeadAllianceRow = { key: string; eventCode: string; matchKey: string | null; alliance: "red" | "blue" | null; teams: number[]; allianceSkill: number | null; allianceNotes: string; scoutName: string; entryId: string };

/** Average skill per team (over every slot a team was rated in), average alliance skill, and the notes. Excluded entries never count. */
export function leadScoutSummary(entries: readonly FormEntry[]): { teams: LeadTeamRow[]; alliances: LeadAllianceRow[] } {
  const live = entries.filter((e) => !e.excluded);
  const byTeam = new Map<number, { skills: number[]; notes: LeadTeamRow["notes"]; entries: number }>();
  for (const e of live) {
    for (const { slot, team } of slotTeams(e.values)) {
      const row = byTeam.get(team) ?? { skills: [], notes: [], entries: 0 };
      row.entries += 1;
      const skill = num(e.values[slotKey(slot, "skill")]);
      if (skill !== null) row.skills.push(skill);
      const text = str(e.values[slotKey(slot, "notes")]).trim();
      if (text) row.notes.push({ text, scoutName: e.scoutName, matchKey: e.matchKey ?? null });
      byTeam.set(team, row);
    }
  }
  const teams = [...byTeam.entries()].map(([teamNumber, r]) => ({ teamNumber, averageSkill: avg(r.skills), entries: r.entries, notes: r.notes })).sort((a, b) => a.teamNumber - b.teamNumber);
  const alliances = live
    .map((e): LeadAllianceRow => ({
      key: `${e.eventCode}|${e.matchKey ?? ""}|${e.alliance ?? ""}|${e.id}`,
      eventCode: e.eventCode,
      matchKey: e.matchKey ?? null,
      alliance: e.alliance ?? null,
      teams: slotTeams(e.values).map((s) => s.team),
      allianceSkill: num(e.values.allianceSkill),
      allianceNotes: str(e.values.allianceNotes).trim(),
      scoutName: e.scoutName,
      entryId: e.id,
    }))
    .sort((a, b) => (a.matchKey ?? "").localeCompare(b.matchKey ?? "", undefined, { numeric: true }));
  return { teams, alliances };
}

// --- Pit Scout ------------------------------------------------------------------------------------------------

export type PitRow = {
  teamNumber: number;
  eventCode: string;
  entryId: string;
  scoutName: string;
  createdAtMs: number;
  photos: ImageValue[];
  /** `${row}_${col}` -> offered and ticked. */
  capabilities: Record<string, boolean>;
  capacity: number | null;
  preloaded: number | null;
  cycleTime: number | null;
  weightLb: number | null;
  rookie: boolean | null;
  friendlyPit: boolean;
  friendlyDrive: boolean;
  autoCycle: string[];
  /** How many entries this team has (the row shown is the latest). */
  entryCount: number;
};

export function pitSummary(page: Pick<FormAnalyticsPage, "unit">, entries: readonly FormEntry[]): PitRow[] {
  const live = entries.filter((e) => !e.excluded && typeof e.teamNumber === "number");
  const counts = new Map<number, number>();
  for (const e of live) counts.set(e.teamNumber!, (counts.get(e.teamNumber!) ?? 0) + 1);
  return latestPerUnit(page, live)
    .map((e): PitRow => ({
      teamNumber: e.teamNumber!,
      eventCode: e.eventCode,
      entryId: e.id,
      scoutName: e.scoutName,
      createdAtMs: e.createdAtMs,
      photos: Array.isArray(e.values.photos) ? (e.values.photos as ImageValue[]) : [],
      capabilities: e.values.capabilities && typeof e.values.capabilities === "object" && !Array.isArray(e.values.capabilities) ? (e.values.capabilities as Record<string, boolean>) : {},
      capacity: num(e.values.capacity),
      preloaded: num(e.values.preloaded),
      cycleTime: num(e.values.cycleTime),
      weightLb: weightInPounds(num(e.values.weight) ?? undefined, str(e.values.weightUnit)),
      rookie: typeof e.values.rookie === "boolean" ? e.values.rookie : null,
      friendlyPit: e.values.friendlyPit === true,
      friendlyDrive: e.values.friendlyDrive === true,
      autoCycle: Array.isArray(e.values.autoCycle) ? (e.values.autoCycle as string[]) : [],
      entryCount: counts.get(e.teamNumber!) ?? 1,
    }))
    .sort((a, b) => a.teamNumber - b.teamNumber);
}

// --- Team Strategy --------------------------------------------------------------------------------------------

export const STRATEGY_ABILITIES = [
  { key: "canScoreHive", label: "Can score in Hive" },
  { key: "canScoreFlower", label: "Can score in Flower" },
  { key: "shootWhileIntaking", label: "Shoot while intaking" },
  { key: "shootWhileMoving", label: "Shoot while moving" },
] as const;

export type StrategyRow = { teamNumber: number; eventCode: string; entryId: string; bestAt: string; abilities: Record<string, boolean>; entryCount: number };

export function teamStrategySummary(page: Pick<FormAnalyticsPage, "unit">, entries: readonly FormEntry[]): { rows: StrategyRow[]; bestAtCounts: Record<string, number> } {
  const live = entries.filter((e) => !e.excluded && typeof e.teamNumber === "number");
  const counts = new Map<number, number>();
  for (const e of live) counts.set(e.teamNumber!, (counts.get(e.teamNumber!) ?? 0) + 1);
  const rows = latestPerUnit(page, live)
    .map((e): StrategyRow => ({
      teamNumber: e.teamNumber!,
      eventCode: e.eventCode,
      entryId: e.id,
      bestAt: str(e.values.bestAt),
      abilities: Object.fromEntries(STRATEGY_ABILITIES.map((a) => [a.key, e.values[a.key] === true])),
      entryCount: counts.get(e.teamNumber!) ?? 1,
    }))
    .sort((a, b) => a.teamNumber - b.teamNumber);
  const bestAtCounts: Record<string, number> = {};
  for (const r of rows) if (r.bestAt) bestAtCounts[r.bestAt] = (bestAtCounts[r.bestAt] ?? 0) + 1;
  return { rows, bestAtCounts };
}

// --- Match Strategy and Drive Reflection -----------------------------------------------------------------------

export type PlanSlot = { slot: number; team: number; role: string; auto: boolean };
export type PlanRow = { key: string; eventCode: string; matchKey: string | null; alliance: "red" | "blue" | null; entryId: string; scoutName: string; createdAtMs: number; slots: PlanSlot[]; planDifferences: number | undefined; linkedEntryId: string | null };

const slotsOf = (e: FormEntry): PlanSlot[] => slotTeams(e.values).map(({ slot, team }) => ({ slot, team, role: str(e.values[slotKey(slot, "role")]), auto: e.values[slotKey(slot, "auto")] === true }));

/** One row per match and alliance: the latest entry's roles. Ordered by event, then match. */
export function planRows(page: Pick<FormAnalyticsPage, "unit">, entries: readonly FormEntry[]): PlanRow[] {
  return latestPerUnit(page, entries.filter((e) => !e.excluded))
    .map((e): PlanRow => ({ key: `${e.eventCode}|${e.matchKey ?? ""}|${e.alliance ?? ""}`, eventCode: e.eventCode, matchKey: e.matchKey ?? null, alliance: e.alliance ?? null, entryId: e.id, scoutName: e.scoutName, createdAtMs: e.createdAtMs, slots: slotsOf(e), planDifferences: e.planDifferences, linkedEntryId: e.linkedEntryId ?? null }))
    .sort((a, b) => a.eventCode.localeCompare(b.eventCode) || (a.matchKey ?? "").localeCompare(b.matchKey ?? "", undefined, { numeric: true }) || (a.alliance ?? "").localeCompare(b.alliance ?? ""));
}

export type ReflectionRow = PlanRow & {
  /** The plan it was compared with (by link, else the latest plan of the same event, match and alliance), or null when nobody planned the match. */
  plan: PlanRow | null;
  /** Slots whose role or auto differ from the plan (empty with no plan). */
  differences: { slot: number; team: number; planned: string; actual: string; field: "role" | "auto" }[];
};

/** Reflections joined to their plan, with every difference listed. */
export function reflectionRows(reflections: readonly FormEntry[], plans: readonly FormEntry[], page: Pick<FormAnalyticsPage, "unit">): ReflectionRow[] {
  const planById = new Map(plans.map((p) => [p.id, p]));
  const planByKey = new Map(planRows(page, plans).map((r) => [r.key, r]));
  return planRows(page, reflections).map((r): ReflectionRow => {
    const linked = r.linkedEntryId ? planById.get(r.linkedEntryId) : undefined;
    const plan: PlanRow | null = linked ? (planRows(page, [linked])[0] ?? null) : (planByKey.get(r.key) ?? null);
    const differences: ReflectionRow["differences"] = [];
    if (plan) {
      for (const s of r.slots) {
        const p = plan.slots.find((x) => x.slot === s.slot);
        if (!p) continue;
        if (p.role !== s.role) differences.push({ slot: s.slot, team: s.team, planned: p.role, actual: s.role, field: "role" });
        if (p.auto !== s.auto) differences.push({ slot: s.slot, team: s.team, planned: p.auto ? "yes" : "no", actual: s.auto ? "yes" : "no", field: "auto" });
      }
    }
    return { ...r, plan, differences };
  });
}

/** "% of matches that went to plan": of the reflections that had a plan, the share with no differences. Null when none had a plan. */
export function wentToPlan(rows: readonly ReflectionRow[]): { planned: number; onPlan: number; percent: number | null } {
  const planned = rows.filter((r) => r.plan !== null);
  const onPlan = planned.filter((r) => r.differences.length === 0).length;
  return { planned: planned.length, onPlan, percent: planned.length === 0 ? null : Math.round((onPlan / planned.length) * 100) };
}

// --- Helper ---------------------------------------------------------------------------------------------------

export type HelperScoutRow = { scoutName: string; assists: number; successful: number; rate: number | null };

export function helperAnalytics(entries: readonly FormEntry[]): { log: FormEntry[]; perScout: HelperScoutRow[]; total: number; successful: number; rate: number | null } {
  const live = entries.filter((e) => !e.excluded).sort((a, b) => b.createdAtMs - a.createdAtMs);
  const by = new Map<string, { assists: number; successful: number }>();
  for (const e of live) {
    const r = by.get(e.scoutName) ?? { assists: 0, successful: 0 };
    r.assists += 1;
    if (e.values.successful === "yes") r.successful += 1;
    by.set(e.scoutName, r);
  }
  const successful = live.filter((e) => e.values.successful === "yes").length;
  return {
    log: live,
    perScout: [...by.entries()].map(([scoutName, r]) => ({ scoutName, ...r, rate: r.assists === 0 ? null : Math.round((r.successful / r.assists) * 100) })).sort((a, b) => b.assists - a.assists || a.scoutName.localeCompare(b.scoutName)),
    total: live.length,
    successful,
    rate: live.length === 0 ? null : Math.round((successful / live.length) * 100),
  };
}

// --- Team Profile ---------------------------------------------------------------------------------------------

export type TeamPitStrategy = {
  pit: PitRow | null;
  strategy: StrategyRow | null;
  /** Average Lead Scout skill for the team, over every rating. */
  leadSkill: number | null;
  leadRatings: number;
  /** True when there is anything to show. */
  any: boolean;
};

/** What the Team Profile's "Pit and Strategy" section shows for one team: its latest pit entry, its latest strategy entry, and its lead-scout skill average. */
export function teamPitStrategy(teamNumber: number, entries: readonly FormEntry[]): TeamPitStrategy {
  const unit = { unit: "team" } as const;
  const mine = (type: FormEntry["formType"]) => entries.filter((e) => e.formType === type && e.teamNumber === teamNumber);
  const pit = pitSummary(unit, mine("pit-scout"))[0] ?? null;
  const strategy = teamStrategySummary(unit, mine("team-strategy")).rows[0] ?? null;
  const lead = leadScoutSummary(entries.filter((e) => e.formType === "lead-scout")).teams.find((t) => t.teamNumber === teamNumber);
  const leadSkill = lead?.averageSkill ?? null;
  return { pit, strategy, leadSkill, leadRatings: lead?.entries ?? 0, any: !!pit || !!strategy || leadSkill !== null };
}
