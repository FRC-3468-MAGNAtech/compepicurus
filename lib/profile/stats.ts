import type { EventAttendance } from "@/lib/event-attendance";
import type { LibraryMatch } from "@/lib/match-library";
import type { PracticeSession } from "@/lib/practice-sessions";
import { computeBadges, type BadgeResult } from "@/lib/profile/badges";
import { RECENT_SESSIONS_SHOWN } from "@/lib/profile/config";
import { currentStreak, longestStreak } from "@/lib/profile/streak";
import { computeScoutStats } from "@/lib/scout-stats/engine";
import type { PracticeSessionSummary, ScoutCategory, ScoutCategoryDetail } from "@/lib/scout-stats/types";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { EventSetup } from "@/lib/scout-status/compute";
import type { ScheduleSlot } from "@/lib/scheduler/types";
import type { TeamMember } from "@/lib/team-members";

// P25: what a profile shows, as pure functions over data the app already loads. The accuracy rows come from
// computeScoutStats() — the same engine as Scout Accuracy and My Scouting, so exclusions, the Real Event default
// and the ranking all agree with those pages. Nothing here recomputes accuracy.

export const PROFILE_CATEGORIES: ScoutCategory[] = ["trial", "competitive", "real-event"];

export type CategoryStat = { category: ScoutCategory; detail: ScoutCategoryDetail | null; rank: number | null };

export type EventEntries = { eventCode: string; entries: number };

export type ProfileStats = {
  categories: CategoryStat[];
  /** The latest sessions (Trial + Competitive, most recent first), each with its PC/Mobile platform. */
  recentSessions: PracticeSessionSummary[];
  /** Completed solo practice sessions, all modes. */
  sessionCount: number;
  streak: number;
  longestStreak: number;
  /** Events this member is on the attendance list of, with the Real Event entries they scouted there. */
  events: EventEntries[];
  /** The latest session or entry activity (ms), or null when there's none. */
  lastActiveMs: number | null;
  badges: BadgeResult[];
};

export type ProfileStatsInput = {
  uid: string;
  members: TeamMember[];
  sessions: PracticeSession[];
  entries: ScoutEntry[];
  libraryMatchesById: Map<string, LibraryMatch>;
  attendance: EventAttendance[];
  now?: Date;
};

const isRealEntry = (e: ScoutEntry) => e.source === "event" || e.source === "live";

export function computeProfileStats(input: ProfileStatsInput): ProfileStats {
  const { uid, members, sessions, entries, libraryMatchesById, attendance } = input;

  const categories: CategoryStat[] = PROFILE_CATEGORIES.map((category) => {
    const result = computeScoutStats({
      category,
      members,
      sessions,
      entries,
      libraryMatchesById,
      attendance,
      roleFilter: [],
      eventFilter: [],
      rankingBasis: "preserve",
      realEventScope: { eventCode: null, variant: "plain" },
    });
    return { category, detail: result.detailsByUid.get(uid) ?? null, rank: result.rows.find((r) => r.uid === uid)?.rank ?? null };
  });

  const detailOf = (c: ScoutCategory) => categories.find((x) => x.category === c)?.detail ?? null;
  const recentSessions = [...(detailOf("trial")?.recentPracticeSessions ?? []), ...(detailOf("competitive")?.recentPracticeSessions ?? [])]
    .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""))
    .slice(0, RECENT_SESSIONS_SHOWN);

  const ownCompleted = sessions.filter((s) => s.uid === uid && s.kind === "solo" && s.status === "completed" && (s.mode === "trial" || s.mode === "competitive"));
  const practiceDates = ownCompleted.map((s) => s.finishedAt ?? s.startedAt);
  const streak = currentStreak(practiceDates, input.now);
  const longest = longestStreak(practiceDates);

  const ownEntries = entries.filter((e) => e.uid === uid && isRealEntry(e) && !e.excluded);
  const entriesByEvent = new Map<string, number>();
  for (const e of ownEntries) entriesByEvent.set(e.eventCode, (entriesByEvent.get(e.eventCode) ?? 0) + 1);
  const events: EventEntries[] = attendance
    .filter((a) => a.uids.includes(uid))
    .map((a) => ({ eventCode: a.eventCode, entries: entriesByEvent.get(a.eventCode) ?? 0 }))
    .sort((a, b) => b.entries - a.entries || a.eventCode.localeCompare(b.eventCode));

  const activity = [...sessions.filter((s) => s.uid === uid).map((s) => s.finishedAt ?? s.startedAt), ...entries.filter((e) => e.uid === uid).map((e) => e.submittedAt)]
    .map((iso) => Date.parse(iso))
    .filter((t) => Number.isFinite(t));
  const lastActiveMs = activity.length > 0 ? Math.max(...activity) : null;

  const nonExcludedAccuracies = ownCompleted.filter((s) => !s.excluded && s.accuracy !== null).map((s) => s.accuracy as number);
  const badges = computeBadges({
    sessionCount: ownCompleted.length,
    bestSessionAccuracy: nonExcludedAccuracies.length > 0 ? Math.max(...nonExcludedAccuracies) : null,
    hasExcellentStatus: categories.some((c) => c.detail?.status?.id === "excellent"),
    longestStreakDays: longest,
    eventsAttended: events.length,
    hasPerfectAlliance: ownEntries.some((e) => e.accuracy?.status === "complete" && e.accuracy.value !== null && Math.round(e.accuracy.value * 100) >= 100),
  });

  return { categories, recentSessions, sessionCount: ownCompleted.length, streak, longestStreak: longest, events, lastActiveMs, badges };
}

export type EventTargetProgress = {
  eventCode: string;
  entries: number;
  /** null when the member has no target at this event. */
  target: number | null;
  /** 0-1, capped at 1; null with no target. */
  completion: number | null;
  /** Where the target came from. */
  source: "manual" | "assignments" | "none";
};

/**
 * Target completion at one event (P16 Scout Status): the member's manual targets from that event's setup (the sum
 * over categories) when an admin set any, else the number of distinct matches Assignments gives them. The Scout Status
 * page's match ranges and category filters aren't re-applied here (a profile doesn't have those controls) — see
 * docs/ASSUMPTIONS.md (P25-8).
 */
export function eventTargetProgress(input: { uid: string; eventCode: string; entries: ScoutEntry[]; setup: EventSetup | null; slots: ScheduleSlot[] | null | undefined }): EventTargetProgress {
  const { uid, eventCode, setup } = input;
  const done = input.entries.filter((e) => e.uid === uid && isRealEntry(e) && !e.excluded && e.eventCode === eventCode);
  // Scout Status compares the number of entries with the target, so this does too.
  const entries = done.length;

  const manual = setup?.individual[uid];
  const manualValues = manual ? Object.values(manual).filter((v): v is number => typeof v === "number") : [];
  let target: number | null = null;
  let source: EventTargetProgress["source"] = "none";
  if (manualValues.length > 0) {
    target = manualValues.reduce((a, b) => a + Math.max(0, Math.round(b)), 0);
    source = "manual";
  } else {
    const assigned = new Set((input.slots ?? []).filter((s) => s.scoutUid === uid).map((s) => `${s.matchType}|${s.matchNumber}`));
    if (assigned.size > 0) {
      target = assigned.size;
      source = "assignments";
    }
  }
  const completion = target !== null && target > 0 ? Math.min(1, entries / target) : null;
  return { eventCode, entries, target, completion, source };
}
