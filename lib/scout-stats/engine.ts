import { getStatus, rankWithTies } from "@/lib/accuracy/engine";
import { formatMatch } from "@/lib/analytics/game-schema";
import { FLAG_RULES_BY_ID } from "@/lib/analytics/flags";
import type { EventAttendance } from "@/lib/event-attendance";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { RoleId } from "@/lib/roles";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import { computeRealEventEstimates, computeTeamAveragePrior, type RealEventObservation } from "./real-event-accuracy";
import type {
  PracticeSessionSummary,
  RankingBasisId,
  RealEventCalculationScope,
  RealEventEntrySummary,
  ScoutCategory,
  ScoutCategoryDetail,
  ScoutLeaderboardRow,
  ScoutStatsResult,
  ScoutStatsSummary,
} from "./types";

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function latestIso(values: (string | null)[]): string | null {
  let latest: string | null = null;
  for (const v of values) {
    if (v && (latest === null || v > latest)) latest = v;
  }
  return latest;
}

/** A real-event scout entry — today that's only `source: "event"`; `"live"` is included too since it means the same thing (Real Event) and simply has no scout-facing way to be created yet (see docs/ARCHITECTURE.md). */
function isRealEventEntry(entry: ScoutEntry): boolean {
  return entry.source === "event" || entry.source === "live";
}

/**
 * P5: turns real-event scout entries into `RealEventObservation[]` for
 * `real-event-accuracy.ts` — entries in the same match that share the
 * exact same `accuracy.value` are alliance partners *by construction*
 * (`lib/analytics/recompute.ts` computes and stores one alliance-level
 * value per match, written onto every entry for that match), so no live
 * FIRST API roster lookup is needed to resolve partners — see
 * docs/ASSUMPTIONS.md (P5).
 */
export function buildRealEventObservations(entries: ScoutEntry[], eventCode: string | null): RealEventObservation[] {
  const scoped = entries.filter(
    (e) =>
      isRealEventEntry(e) &&
      !e.excluded &&
      e.accuracy?.status === "complete" &&
      e.accuracy.value !== null &&
      (eventCode === null || e.eventCode === eventCode)
  );

  const byMatch = new Map<string, ScoutEntry[]>();
  for (const e of scoped) {
    const key = `${e.eventCode}|${e.matchType}|${e.matchNumber}`;
    const list = byMatch.get(key) ?? [];
    list.push(e);
    byMatch.set(key, list);
  }

  const observations: RealEventObservation[] = [];
  for (const group of byMatch.values()) {
    for (const entry of group) {
      const value = entry.accuracy!.value as number;
      const partner = group.find(
        (o) => o.id !== entry.id && o.teamNumber !== entry.teamNumber && Math.abs((o.accuracy!.value as number) - value) < 1e-9
      );
      observations.push({ scoutUid: entry.uid, partnerUid: partner ? partner.uid : null, accuracy: value });
    }
  }
  return observations;
}

/** A member's own average accuracy (0-100) in one practice mode — the prior the (Trial)/(Competitive) Real Event calculation variants use. Null if they have no completed, non-excluded sessions in that mode. */
export function computePracticeAverageAccuracy(sessions: PracticeSession[], uid: string, mode: "trial" | "competitive"): number | null {
  const own = sessions.filter((s) => s.uid === uid && s.kind === "solo" && s.mode === mode && s.status === "completed" && !s.excluded);
  if (own.length === 0) return null;
  return mean(own.map((s) => s.accuracy ?? 0));
}

function practiceSessionSummary(session: PracticeSession, libraryMatchesById: Map<string, LibraryMatch>): PracticeSessionSummary {
  const match = session.libraryMatchId ? libraryMatchesById.get(session.libraryMatchId) : undefined;
  return {
    sessionId: session.id,
    matchLabel: match ? formatMatch(match) : "Unknown match",
    date: session.finishedAt,
    accuracy: session.accuracy,
    platform: session.platform,
    activeFlags: session.flags.filter((f) => !f.dismissed).map((f) => ({ type: f.type, title: f.title, detail: f.detail })),
    excluded: session.excluded,
  };
}

function computePracticeDetail(
  uid: string,
  name: string,
  sessions: PracticeSession[],
  mode: "trial" | "competitive",
  libraryMatchesById: Map<string, LibraryMatch>
): ScoutCategoryDetail {
  const own = sessions.filter((s) => s.uid === uid && s.kind === "solo" && s.mode === mode && s.status === "completed");
  const nonExcluded = own.filter((s) => !s.excluded);
  const averageAccuracy = nonExcluded.length > 0 ? mean(nonExcluded.map((s) => s.accuracy ?? 0)) : null;
  const sorted = [...own].sort((a, b) => (b.finishedAt ?? "").localeCompare(a.finishedAt ?? ""));

  return {
    uid,
    name,
    averageAccuracy,
    status: averageAccuracy === null ? null : getStatus(averageAccuracy),
    sessionsOrForms: own.length,
    totalEntries: own.reduce((sum, s) => sum + s.entryIds.length, 0),
    lastScoutedAt: latestIso(own.map((s) => s.finishedAt)),
    recentPracticeSessions: sorted.map((s) => practiceSessionSummary(s, libraryMatchesById)),
    recentRealEntries: [],
  };
}

function realEventEntrySummary(entry: ScoutEntry): RealEventEntrySummary {
  return {
    entryId: entry.id,
    matchLabel: formatMatch(entry),
    accuracy: entry.accuracy?.status === "complete" && entry.accuracy.value !== null ? entry.accuracy.value * 100 : null,
    activeAutoFlagTitles: entry.autoFlags.filter((f) => !f.dismissed).map((f) => FLAG_RULES_BY_ID[f.ruleId]?.title ?? f.ruleId),
    manualFlagReasons: entry.manualFlags.map((f) => f.reason),
    excluded: entry.excluded,
  };
}

function computeRealEventDetail(
  uid: string,
  name: string,
  entries: ScoutEntry[],
  eventCode: string | null,
  estimate: number | null
): ScoutCategoryDetail {
  const own = entries.filter((e) => e.uid === uid && isRealEventEntry(e) && (eventCode === null || e.eventCode === eventCode));
  const sorted = [...own].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  return {
    uid,
    name,
    averageAccuracy: estimate,
    status: estimate === null ? null : getStatus(estimate),
    sessionsOrForms: own.length,
    totalEntries: null,
    lastScoutedAt: latestIso(own.map((e) => e.submittedAt)),
    recentPracticeSessions: [],
    recentRealEntries: sorted.map(realEventEntrySummary),
  };
}

function memberMatchesRoles(member: TeamMember, roleFilter: RoleId[]): boolean {
  if (roleFilter.length === 0) return true;
  return roleFilter.includes(member.primaryRole) || member.secondaryRoles.some((r) => roleFilter.includes(r));
}

function memberMatchesEvents(member: TeamMember, eventFilter: string[], attendance: EventAttendance[]): boolean {
  if (eventFilter.length === 0) return true;
  return attendance.some((a) => a.uid === member.uid && eventFilter.includes(a.eventCode));
}

export type ScoutStatsInput = {
  category: ScoutCategory;
  members: TeamMember[];
  /** Every `kind: "solo"` session for the team, any status. */
  sessions: PracticeSession[];
  /** Every scout entry for the team, any source. */
  entries: ScoutEntry[];
  libraryMatchesById: Map<string, LibraryMatch>;
  attendance: EventAttendance[];
  /** Empty = no filter. */
  roleFilter: RoleId[];
  /** Empty = no filter. Event *codes*. */
  eventFilter: string[];
  rankingBasis: RankingBasisId;
  /** Only read when `category === "real-event"`. */
  realEventScope: RealEventCalculationScope;
};

/**
 * The one place Scout Accuracy and My Scouting both compute their numbers
 * from — pure given already-fetched Firestore data, so it's fully
 * unit-testable without an emulator. See docs/ARCHITECTURE.md (P5) for how
 * each category's numbers are derived.
 */
export function computeScoutStats(input: ScoutStatsInput): ScoutStatsResult {
  const { category, members, sessions, entries, libraryMatchesById, attendance, roleFilter, eventFilter, rankingBasis, realEventScope } =
    input;

  const detailsByUid = new Map<string, ScoutCategoryDetail>();

  if (category === "real-event") {
    const observations = buildRealEventObservations(entries, realEventScope.eventCode);
    const teamAveragePrior = computeTeamAveragePrior(observations);
    const modePriors = new Map<string, number>();
    if (realEventScope.variant !== "plain") {
      for (const member of members) {
        const avg = computePracticeAverageAccuracy(sessions, member.uid, realEventScope.variant);
        if (avg !== null) modePriors.set(member.uid, avg / 100);
      }
    }
    const estimates = computeRealEventEstimates(observations, realEventScope.variant, teamAveragePrior, modePriors);
    for (const member of members) {
      const estimate = estimates.get(member.uid);
      detailsByUid.set(
        member.uid,
        computeRealEventDetail(member.uid, member.name, entries, realEventScope.eventCode, estimate !== undefined && estimate !== null ? estimate * 100 : null)
      );
    }
  } else {
    for (const member of members) {
      detailsByUid.set(member.uid, computePracticeDetail(member.uid, member.name, sessions, category, libraryMatchesById));
    }
  }

  const accuracyOf = (uid: string): number | null => detailsByUid.get(uid)?.averageAccuracy ?? null;

  const rankPool = (pool: TeamMember[]) => {
    const ranked = rankWithTies(pool, (m) => accuracyOf(m.uid));
    return new Map(ranked.map((r) => [r.item.uid, r.rank]));
  };

  const rankPreserve = rankPool(members);
  const roleMatches = members.filter((m) => memberMatchesRoles(m, roleFilter));
  const eventMatches = members.filter((m) => memberMatchesEvents(m, eventFilter, attendance));
  const bothMatches = members.filter((m) => memberMatchesRoles(m, roleFilter) && memberMatchesEvents(m, eventFilter, attendance));

  const ranksByBasis: Record<RankingBasisId, Map<string, number | null>> = {
    preserve: rankPreserve,
    role: roleFilter.length > 0 ? rankPool(roleMatches) : rankPreserve,
    event: eventFilter.length > 0 ? rankPool(eventMatches) : rankPreserve,
    both: roleFilter.length > 0 && eventFilter.length > 0 ? rankPool(bothMatches) : rankPreserve,
  };
  const activeRanks = ranksByBasis[rankingBasis];

  const visibleMembers = members.filter((m) => memberMatchesRoles(m, roleFilter) && memberMatchesEvents(m, eventFilter, attendance));

  const rows: ScoutLeaderboardRow[] = visibleMembers.map((member) => {
    const detail = detailsByUid.get(member.uid)!;
    return {
      uid: member.uid,
      name: member.name,
      primaryRole: member.primaryRole,
      secondaryRoles: member.secondaryRoles,
      accuracy: detail.averageAccuracy,
      status: detail.status,
      sessionsOrForms: detail.sessionsOrForms,
      totalEntries: detail.totalEntries,
      rank: activeRanks.get(member.uid) ?? null,
    };
  });
  rows.sort((a, b) => {
    if (a.rank === null && b.rank === null) return 0;
    if (a.rank === null) return 1;
    if (b.rank === null) return -1;
    return a.rank - b.rank;
  });

  const withData = rows.filter((r) => r.accuracy !== null);
  const summary: ScoutStatsSummary = {
    membersWithData: withData.length,
    totalMembers: rows.length,
    averageAccuracy: withData.length > 0 ? mean(withData.map((r) => r.accuracy!)) : null,
    sessionsOrFormsCompleted: rows.reduce((sum, r) => sum + r.sessionsOrForms, 0),
    totalEntries: category === "real-event" ? null : rows.reduce((sum, r) => sum + (r.totalEntries ?? 0), 0),
  };

  return { rows, summary, detailsByUid };
}
