import type { TeamAssignRow } from "@/lib/team-assignments/distribute";
import type { DistributeMode } from "@/lib/team-assignments/distribute";

// P31: the stored shape of a Pit Scouting / Team Strategy assignment, and the pure helpers that read it. No Firebase here.

export type TeamAssignKind = "pit" | "teamStrategy";
export const TEAM_ASSIGN_KINDS: readonly TeamAssignKind[] = ["pit", "teamStrategy"];

export type TeamAssignKindInfo = {
  kind: TeamAssignKind;
  /** The Assignments tab. */
  tab: string;
  /** What the scouts call it ("pit scouting"). */
  noun: string;
  formId: string;
  /** The P26 page id whose access makes someone an eligible scout. */
  pageId: string;
  href: string;
};

export const TEAM_ASSIGN_KIND_INFO: Record<TeamAssignKind, TeamAssignKindInfo> = {
  pit: { kind: "pit", tab: "Pit Scouting", noun: "pit scouting", formId: "pit-scout-v1", pageId: "pit-scout-form", href: "/pit-scout-form" },
  teamStrategy: { kind: "teamStrategy", tab: "Team Strategy", noun: "team strategy", formId: "team-strategy-v1", pageId: "team-strategy-form", href: "/team-strategy-form" },
};

export type TeamAssignSettings = {
  scoutUids: string[];
  priorityTeams: number[];
  priorityCoverage: 1 | 2;
  mode: DistributeMode;
  /** Our own FTC teams were included in the units. */
  includeOurs: boolean;
  seed: number;
};

export type TeamAssignVersion = {
  generatedBy: string;
  /** ISO. */
  generatedAt: string;
  settings: TeamAssignSettings;
  teams: TeamAssignRow[];
  counts: Record<string, number>;
  uneven: boolean;
  warning: string | null;
};

export type TeamAssignmentsDoc = {
  id: string;
  teamId: string;
  eventCode: string;
  kind: TeamAssignKind;
  current: TeamAssignVersion | null;
  previous: TeamAssignVersion | null;
};

const isKind = (v: unknown): v is TeamAssignKind => v === "pit" || v === "teamStrategy";

function parseVersion(raw: unknown): TeamAssignVersion | null {
  if (!raw || typeof raw !== "object") return null;
  const v = raw as Record<string, unknown>;
  if (!Array.isArray(v.teams)) return null;
  const teams: TeamAssignRow[] = [];
  for (const t of v.teams) {
    if (!t || typeof t !== "object") continue;
    const r = t as Record<string, unknown>;
    if (typeof r.teamNumber !== "number") continue;
    teams.push({ teamNumber: r.teamNumber, scoutUids: Array.isArray(r.scoutUids) ? r.scoutUids.filter((u): u is string => typeof u === "string") : [], locked: r.locked === true });
  }
  const s = (v.settings ?? {}) as Record<string, unknown>;
  return {
    generatedBy: typeof v.generatedBy === "string" ? v.generatedBy : "",
    generatedAt: typeof v.generatedAt === "string" ? v.generatedAt : "",
    settings: {
      scoutUids: Array.isArray(s.scoutUids) ? s.scoutUids.filter((u): u is string => typeof u === "string") : [],
      priorityTeams: Array.isArray(s.priorityTeams) ? s.priorityTeams.filter((n): n is number => typeof n === "number") : [],
      priorityCoverage: s.priorityCoverage === 1 ? 1 : 2,
      mode: s.mode === "sequential-blocks" ? "sequential-blocks" : "balanced-random",
      includeOurs: s.includeOurs === true,
      seed: typeof s.seed === "number" ? s.seed : 0,
    },
    teams,
    counts: v.counts && typeof v.counts === "object" ? (v.counts as Record<string, number>) : {},
    uneven: v.uneven === true,
    warning: typeof v.warning === "string" ? v.warning : null,
  };
}

/** A stored doc as a `TeamAssignmentsDoc`; null for a Match Scouting doc (no `kind`) or a malformed one. */
export function parseTeamAssignmentsDoc(id: string, data: Record<string, unknown>): TeamAssignmentsDoc | null {
  if (!isKind(data.kind) || typeof data.teamId !== "string" || typeof data.eventCode !== "string") return null;
  return { id, teamId: data.teamId, eventCode: data.eventCode, kind: data.kind, current: parseVersion(data.current), previous: parseVersion(data.previous) };
}

/** Teams per scout from the published versions of one kind, summed over `eventCodes` (null when none of them has one: no assignments to prefill from). */
export function assignedTeamCounts(docs: readonly TeamAssignmentsDoc[], eventCodes: readonly string[], kind: TeamAssignKind): ReadonlyMap<string, number> | null {
  const published = docs.filter((d) => d.kind === kind && eventCodes.includes(d.eventCode) && d.current);
  if (published.length === 0) return null;
  const counts = new Map<string, number>();
  for (const d of published) for (const row of d.current!.teams) for (const uid of row.scoutUids) counts.set(uid, (counts.get(uid) ?? 0) + 1);
  return counts;
}

/** A person's published teams for one event and kind. */
export function myAssignedTeams(docs: readonly TeamAssignmentsDoc[], eventCode: string | null, kind: TeamAssignKind, uid: string | null | undefined): number[] {
  if (!eventCode || !uid) return [];
  const d = docs.find((x) => x.eventCode === eventCode && x.kind === kind);
  return (d?.current?.teams ?? []).filter((r) => r.scoutUids.includes(uid)).map((r) => r.teamNumber).sort((a, b) => a - b);
}

/** Has the version changed since `seen` (an ISO `generatedAt`), and is it new enough to announce (within `maxAgeMs` of `now`)? */
export function isNewPublish(current: Pick<TeamAssignVersion, "generatedAt"> | null, seen: string | null, now: number, maxAgeMs: number): boolean {
  if (!current?.generatedAt) return false;
  if (seen === current.generatedAt) return false;
  const at = Date.parse(current.generatedAt);
  return Number.isFinite(at) && now - at <= maxAgeMs;
}
