import { describe, expect, it } from "vitest";
import type { PracticeSession } from "@/lib/practice-sessions";
import type { ScoutEntry } from "@/lib/scout-entries";
import type { TeamMember } from "@/lib/team-members";
import type { EventAttendance } from "@/lib/event-attendance";
import { BADGES, computeBadges, type BadgeFacts } from "./badges";
import { AVATAR_PRESETS, DEFAULT_AVATAR, DEFAULT_PROFILE_VISIBILITY } from "./config";
import {
  canModerateProfile,
  effectiveVisibility,
  headerName,
  initialsOf,
  isGoogleAvatarUrl,
  parseAvatar,
  parseProfile,
  profileAccess,
  sanitizeBio,
  sanitizePronouns,
  visibilityToSave,
} from "./model";
import { monthYear, relativeTime } from "./format";
import { computeProfileStats, eventTargetProgress } from "./stats";
import { currentStreak, longestStreak, localDayNumber } from "./streak";

function member(uid: string, overrides: Partial<TeamMember> = {}): TeamMember {
  return { uid, name: uid, email: `${uid}@x.com`, primaryRole: "match-scout", secondaryRoles: [], isAdmin: false, isOwner: false, ...overrides };
}

function session(id: string, uid: string, overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    id,
    teamId: "t",
    uid,
    scoutName: uid,
    kind: "solo",
    seasonId: "s",
    mode: "trial",
    difficulty: "medium",
    libraryMatchId: null,
    eventCode: null,
    alliance: "red",
    robots: [1, 2],
    status: "completed",
    completedRobots: [1, 2],
    entryIds: ["a", "b"],
    accuracy: 90,
    scoutedTotal: 90,
    penaltyPoints: 0,
    officialScore: 100,
    platform: "pc",
    flags: [],
    excluded: false,
    lobbyId: null,
    pairId: null,
    startedAt: "2026-03-01T10:00:00.000Z",
    finishedAt: "2026-03-01T10:10:00.000Z",
    matchType: null,
    matchNumber: null,
    allianceTeams: null,
    streamUrl: null,
    streamStartSec: null,
    streamEndSec: null,
    ...overrides,
  };
}

function entry(id: string, uid: string, overrides: Partial<ScoutEntry> = {}): ScoutEntry {
  return {
    id,
    teamId: "t",
    uid,
    source: "event",
    mode: null,
    formId: "f",
    formVersion: 1,
    scoutName: uid,
    eventCode: "EV1",
    matchType: "Qualification",
    matchNumber: 1,
    teamNumber: 1,
    fields: {} as ScoutEntry["fields"],
    score: { auto: 0, teleop: 0, endgame: 0, total: 0 },
    comments: "",
    submittedAt: "2026-03-02T10:00:00.000Z",
    excluded: false,
    autoFlags: [],
    manualFlags: [],
    accuracy: null,
    sessionId: null,
    libraryMatchId: null,
    ...overrides,
  };
}

const facts = (o: Partial<BadgeFacts> = {}): BadgeFacts => ({ sessionCount: 0, bestSessionAccuracy: null, hasExcellentStatus: false, longestStreakDays: 0, eventsAttended: 0, hasPerfectAlliance: false, ...o });
const earnedIds = (f: BadgeFacts) => computeBadges(f).filter((b) => b.earned).map((b) => b.badge.id);

describe("visibility", () => {
  it("defaults come from the one constant", () => {
    expect(parseProfile(undefined, "t").visibility).toBe(DEFAULT_PROFILE_VISIBILITY);
    expect(effectiveVisibility({ visibility: undefined, isAdmin: false })).toBe(DEFAULT_PROFILE_VISIBILITY);
  });

  it("an admin is always public; a demoted admin gets their saved preference back", () => {
    expect(effectiveVisibility({ visibility: "private", isAdmin: true })).toBe("public");
    expect(effectiveVisibility({ visibility: "private", isAdmin: false })).toBe("private");
  });

  it("a private profile is limited for non-admin teammates, and full for the owner of it, admins, and public profiles", () => {
    const base = { viewerUid: "v", viewerIsAdmin: false, targetUid: "t", targetIsAdmin: false };
    expect(profileAccess({ ...base, visibility: "private" })).toBe("limited");
    expect(profileAccess({ ...base, visibility: "public" })).toBe("full");
    expect(profileAccess({ ...base, visibility: "private", viewerUid: "t" })).toBe("full");
    expect(profileAccess({ ...base, visibility: "private", viewerIsAdmin: true })).toBe("full");
    expect(profileAccess({ ...base, visibility: "private", targetIsAdmin: true })).toBe("full");
  });

  it("only an admin can moderate, never themself and never the owner", () => {
    expect(canModerateProfile({ viewerUid: "a", viewerIsAdmin: true, targetUid: "m", targetIsOwner: false })).toBe(true);
    expect(canModerateProfile({ viewerUid: "a", viewerIsAdmin: false, targetUid: "m", targetIsOwner: false })).toBe(false);
    expect(canModerateProfile({ viewerUid: "a", viewerIsAdmin: true, targetUid: "a", targetIsOwner: false })).toBe(false);
    expect(canModerateProfile({ viewerUid: "a", viewerIsAdmin: true, targetUid: "o", targetIsOwner: true })).toBe(false);
  });
});

describe("saving visibility", () => {
  it("a member saves what they chose", () => {
    expect(visibilityToSave({ isAdmin: false, chosen: "private", existing: "public" })).toBe("private");
    expect(visibilityToSave({ isAdmin: false, chosen: "public", existing: null })).toBe("public");
  });

  it("an admin keeps the preference they had (it returns if they are demoted); a first save is public", () => {
    expect(visibilityToSave({ isAdmin: true, chosen: "public", existing: "private" })).toBe("private");
    expect(visibilityToSave({ isAdmin: true, chosen: "private", existing: null })).toBe("public");
  });
});

describe("display helpers", () => {
  const now = Date.UTC(2026, 5, 15, 12);
  it("relative time", () => {
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 60_000, now)).toBe("1 minute ago");
    expect(relativeTime(now - 5 * 3_600_000, now)).toBe("5 hours ago");
    expect(relativeTime(now - 30 * 3_600_000, now)).toBe("yesterday");
    expect(relativeTime(now - 6 * 86_400_000, now)).toBe("6 days ago");
    expect(relativeTime(now - 40 * 86_400_000, now)).toMatch(/2026/);
  });
  it("month and year", () => {
    expect(monthYear(Date.UTC(2026, 2, 10, 12))).toMatch(/2026/);
  });
});

describe("text and avatars", () => {
  it("bio is plain text: tags and control characters go, blank-line runs collapse, length is capped", () => {
    expect(sanitizeBio("hi <b>there</b><script>x()</script>\u0007!")).toBe("hi therex()!");
    expect(sanitizeBio("a\n\n\n\nb\r\nc  \nd")).toBe("a\n\nb\nc\nd");
    expect(sanitizeBio("x".repeat(500))).toHaveLength(280);
    expect(sanitizeBio("  1 < 5  ")).toBe("1 < 5");
  });

  it("pronouns are a single short line", () => {
    expect(sanitizePronouns("they\n/\tthem")).toBe("they / them");
    expect(sanitizePronouns("x".repeat(100))).toHaveLength(30);
  });

  it("google avatars must be https googleusercontent URLs", () => {
    expect(isGoogleAvatarUrl("https://lh3.googleusercontent.com/a/abc=s96-c")).toBe(true);
    expect(isGoogleAvatarUrl("http://lh3.googleusercontent.com/a/abc")).toBe(false);
    expect(isGoogleAvatarUrl("https://evil.example.com/a.png")).toBe(false);
    expect(isGoogleAvatarUrl("https://lh3.googleusercontent.com.evil.com/x")).toBe(false);
    expect(isGoogleAvatarUrl("javascript:alert(1)")).toBe(false);
  });

  it("an unreadable or unsafe avatar becomes initials", () => {
    expect(parseAvatar(null)).toEqual(DEFAULT_AVATAR);
    expect(parseAvatar({ type: "preset", value: "nope" })).toEqual(DEFAULT_AVATAR);
    expect(parseAvatar({ type: "google", value: "https://evil.example.com/x" })).toEqual(DEFAULT_AVATAR);
    expect(parseAvatar({ type: "preset", value: AVATAR_PRESETS[0].id })).toEqual({ type: "preset", value: AVATAR_PRESETS[0].id });
  });

  it("header name falls back to the account name; initials take two letters", () => {
    expect(headerName({ displayName: "  " }, "Ada Lovelace")).toBe("Ada Lovelace");
    expect(headerName({ displayName: "Ada L." }, "Ada Lovelace")).toBe("Ada L.");
    expect(headerName(null, "Ada")).toBe("Ada");
    expect(initialsOf("ada king lovelace")).toBe("AK");
  });
});

describe("streaks (local days)", () => {
  const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).toISOString();
  const now = new Date(2026, 2, 10, 15);

  it("counts consecutive days ending today", () => {
    expect(currentStreak([at(2026, 3, 8), at(2026, 3, 9), at(2026, 3, 10)], now)).toBe(3);
  });

  it("stays alive through yesterday, dies after a missed day", () => {
    expect(currentStreak([at(2026, 3, 8), at(2026, 3, 9)], now)).toBe(2);
    expect(currentStreak([at(2026, 3, 7), at(2026, 3, 8)], now)).toBe(0);
  });

  it("several sessions a day count once, and a gap resets the run", () => {
    expect(currentStreak([at(2026, 3, 10, 9), at(2026, 3, 10, 18), at(2026, 3, 9), at(2026, 3, 7)], now)).toBe(2);
  });

  it("no sessions, no streak; bad dates are ignored", () => {
    expect(currentStreak([], now)).toBe(0);
    expect(currentStreak(["nope", null, undefined], now)).toBe(0);
    expect(localDayNumber("nope")).toBeNull();
  });

  it("the longest run ever", () => {
    expect(longestStreak([at(2026, 1, 1), at(2026, 1, 2), at(2026, 1, 3), at(2026, 1, 5), at(2026, 1, 6)])).toBe(3);
    expect(longestStreak([])).toBe(0);
  });

  it("is local time, across a month end", () => {
    expect(currentStreak([at(2026, 2, 28), at(2026, 3, 1)], new Date(2026, 2, 1, 20))).toBe(2);
  });
});

describe("badges", () => {
  it("nothing earned with nothing done", () => {
    expect(earnedIds(facts())).toEqual([]);
  });

  it("session count thresholds", () => {
    expect(earnedIds(facts({ sessionCount: 1 }))).toEqual(["first-session"]);
    expect(earnedIds(facts({ sessionCount: 10 }))).toEqual(["first-session", "ten-sessions"]);
    expect(earnedIds(facts({ sessionCount: 50 }))).toEqual(["first-session", "ten-sessions", "fifty-sessions"]);
  });

  it("100% session rounds to 100", () => {
    expect(earnedIds(facts({ bestSessionAccuracy: 99.6 }))).toContain("perfect-session");
    expect(earnedIds(facts({ bestSessionAccuracy: 99.4 }))).not.toContain("perfect-session");
    expect(earnedIds(facts({ bestSessionAccuracy: null }))).not.toContain("perfect-session");
  });

  it("status, streak, event veteran and perfect alliance", () => {
    expect(earnedIds(facts({ hasExcellentStatus: true }))).toEqual(["excellent"]);
    expect(earnedIds(facts({ longestStreakDays: 4 }))).toEqual([]);
    expect(earnedIds(facts({ longestStreakDays: 5 }))).toEqual(["streak"]);
    expect(earnedIds(facts({ eventsAttended: 2 }))).toEqual([]);
    expect(earnedIds(facts({ eventsAttended: 3 }))).toEqual(["event-veteran"]);
    expect(earnedIds(facts({ hasPerfectAlliance: true }))).toEqual(["perfect-alliance"]);
  });

  it("every badge has a unique id, label and description", () => {
    expect(new Set(BADGES.map((b) => b.id)).size).toBe(BADGES.length);
    for (const b of BADGES) expect(b.label && b.description && b.icon).toBeTruthy();
  });
});

describe("computeProfileStats", () => {
  const members = [member("me"), member("peer", { name: "Peer" })];
  const attendance: EventAttendance[] = [
    { id: "t_EV1", teamId: "t", eventCode: "EV1", uids: ["me"], updatedAt: null },
    { id: "t_EV2", teamId: "t", eventCode: "EV2", uids: ["me", "peer"], updatedAt: null },
  ];
  const run = (o: Partial<Parameters<typeof computeProfileStats>[0]> = {}) =>
    computeProfileStats({ uid: "me", members, sessions: [], entries: [], libraryMatchesById: new Map(), attendance: [], now: new Date(2026, 2, 3, 12), ...o });

  it("an empty member has empty everything", () => {
    const s = run();
    expect(s.categories.map((c) => c.detail?.averageAccuracy)).toEqual([null, null, null]);
    expect(s.categories.map((c) => c.rank)).toEqual([null, null, null]);
    expect(s.recentSessions).toEqual([]);
    expect(s.sessionCount).toBe(0);
    expect(s.streak).toBe(0);
    expect(s.events).toEqual([]);
    expect(s.lastActiveMs).toBeNull();
    expect(s.badges.every((b) => !b.earned)).toBe(true);
  });

  it("reuses the Scout Accuracy numbers: averages per mode, ranks, exclusions", () => {
    const sessions = [
      session("1", "me", { accuracy: 80 }),
      session("2", "me", { accuracy: 100, finishedAt: "2026-03-02T10:00:00.000Z" }),
      session("3", "me", { accuracy: 10, excluded: true, finishedAt: "2026-03-02T11:00:00.000Z" }),
      session("4", "me", { mode: "competitive", accuracy: 70, platform: "mobile", finishedAt: "2026-03-03T09:00:00.000Z" }),
      session("5", "peer", { accuracy: 95 }),
    ];
    const s = run({ sessions });
    const trial = s.categories.find((c) => c.category === "trial")!;
    expect(trial.detail?.averageAccuracy).toBe(90); // the excluded 10% is left out
    expect(trial.detail?.sessionsOrForms).toBe(3);
    expect(trial.rank).toBe(2); // peer has 95
    const comp = s.categories.find((c) => c.category === "competitive")!;
    expect(comp.detail?.averageAccuracy).toBe(70);
    expect(comp.rank).toBe(1);
    expect(s.sessionCount).toBe(4);
  });

  it("lists the last five sessions across modes with their platform, newest first", () => {
    const sessions = Array.from({ length: 7 }, (_, i) =>
      session(String(i), "me", { finishedAt: `2026-03-0${i + 1}T10:00:00.000Z`, mode: i % 2 ? "competitive" : "trial", platform: i === 6 ? "mobile" : "pc" })
    );
    const s = run({ sessions });
    expect(s.recentSessions).toHaveLength(5);
    expect(s.recentSessions[0].sessionId).toBe("6");
    expect(s.recentSessions[0].platform).toBe("mobile");
    expect(s.recentSessions.map((x) => x.date)).toEqual([...s.recentSessions.map((x) => x.date)].sort().reverse());
  });

  it("ignores other members' and unfinished sessions", () => {
    const s = run({ sessions: [session("1", "peer"), session("2", "me", { status: "in-progress" }), session("3", "me", { kind: "live" })] });
    expect(s.sessionCount).toBe(0);
  });

  it("streak from completed practice days", () => {
    const sessions = [session("1", "me", { finishedAt: new Date(2026, 2, 1, 12).toISOString() }), session("2", "me", { finishedAt: new Date(2026, 2, 2, 12).toISOString() }), session("3", "me", { finishedAt: new Date(2026, 2, 3, 8).toISOString() })];
    const s = run({ sessions });
    expect(s.streak).toBe(3);
    expect(s.longestStreak).toBe(3);
  });

  it("events attended with entries per event (excluded entries and practice entries don't count)", () => {
    const entries = [
      entry("a", "me", { eventCode: "EV2" }),
      entry("b", "me", { eventCode: "EV2", matchNumber: 2 }),
      entry("c", "me", { eventCode: "EV2", matchNumber: 3, excluded: true }),
      entry("d", "me", { eventCode: "EV1", source: "live" }),
      entry("e", "me", { eventCode: "EV1", source: "practice" }),
      entry("f", "peer", { eventCode: "EV1" }),
    ];
    const s = run({ entries, attendance });
    expect(s.events).toEqual([
      { eventCode: "EV2", entries: 2 },
      { eventCode: "EV1", entries: 1 },
    ]);
  });

  it("last active is the latest of sessions and entries", () => {
    const s = run({ sessions: [session("1", "me", { finishedAt: "2026-03-01T10:00:00.000Z" })], entries: [entry("a", "me", { submittedAt: "2026-04-01T00:00:00.000Z" })] });
    expect(s.lastActiveMs).toBe(Date.parse("2026-04-01T00:00:00.000Z"));
  });

  it("feeds badges: first session, 100% session, perfect alliance, event veteran", () => {
    const entries = [entry("a", "me", { accuracy: { status: "complete", value: 1, scoutedTotal: 50, penaltyPoints: 0, officialScore: 50 } })];
    const att: EventAttendance[] = ["A", "B", "C"].map((c) => ({ id: c, teamId: "t", eventCode: c, uids: ["me"], updatedAt: null }));
    const s = run({ sessions: [session("1", "me", { accuracy: 100 })], entries, attendance: att });
    const earned = s.badges.filter((b) => b.earned).map((b) => b.badge.id);
    expect(earned).toEqual(expect.arrayContaining(["first-session", "perfect-session", "perfect-alliance", "event-veteran"]));
  });
});

describe("eventTargetProgress", () => {
  const entries = [entry("a", "me", { matchNumber: 1 }), entry("b", "me", { matchNumber: 2 }), entry("c", "me", { matchNumber: 3, excluded: true }), entry("d", "peer"), entry("e", "me", { eventCode: "OTHER" })];
  const slot = (matchNumber: number, scoutUid: string) => ({ matchType: "Qualification", matchNumber, scoutUid, teamNumber: 1 }) as never;

  it("uses a manual target when one is set (summed over categories)", () => {
    const p = eventTargetProgress({ uid: "me", eventCode: "EV1", entries, setup: { ranges: {}, maxOverrides: {}, individual: { me: { qualification: 6, practice: 2 } }, extraScouts: [] }, slots: [slot(1, "me")] });
    expect(p).toEqual({ eventCode: "EV1", entries: 2, target: 8, completion: 0.25, source: "manual" });
  });

  it("else the distinct matches Assignments gives them", () => {
    const p = eventTargetProgress({ uid: "me", eventCode: "EV1", entries, setup: null, slots: [slot(1, "me"), slot(1, "me"), slot(2, "me"), slot(3, "me"), slot(4, "peer")] });
    expect(p.target).toBe(3);
    expect(p.source).toBe("assignments");
    expect(p.completion).toBeCloseTo(2 / 3);
  });

  it("no target means no completion, and completion is capped at 100%", () => {
    expect(eventTargetProgress({ uid: "me", eventCode: "EV1", entries, setup: null, slots: [] })).toMatchObject({ target: null, completion: null, source: "none" });
    expect(eventTargetProgress({ uid: "me", eventCode: "EV1", entries, setup: { ranges: {}, maxOverrides: {}, individual: { me: { qualification: 1 } }, extraScouts: [] }, slots: [] }).completion).toBe(1);
  });
});
